<?php

// Frontend-owned synthetic control. This file is copied only into the disposable
// published-backend container; it does not add an HTTP route or alter its source.
use App\Modules\Auditing\Data\AuditContext;
use App\Modules\Auditing\Enums\AuditSource;
use App\Modules\Authorization\Actions\RemovePermissionAction;
use App\Modules\Authorization\Models\Permission;
use App\Modules\Authorization\Models\Role;
use App\Modules\Authorization\Models\StoreMembership;
use App\Modules\Catalog\Enums\CategoryStatus;
use App\Modules\Catalog\Enums\ProductStatus;
use App\Modules\Catalog\Enums\ProductType;
use App\Modules\Catalog\Models\Category;
use App\Modules\Catalog\Models\Product;
use App\Modules\Catalog\Services\CatalogDiscoveryKey;
use App\Modules\Identity\Models\User;
use App\Modules\Stores\Enums\StoreCurrency;
use App\Modules\Stores\Models\Store;
use App\Modules\Tenancy\Resolvers\ResolveTenantFromMembershipService;
use App\Modules\Tenancy\Services\DestroyTenantContextService;
use App\Modules\Tenancy\Services\InitializeTenantContextService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesMerchantContext;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (app()->environment() !== 'local' || DB::selectOne('select current_database() as name')->name !== 'qafilah_f2_isolated') {
    throw new RuntimeException('F3 fixtures require the isolated local integration database.');
}

final class FrontendProductFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext
    {
        return AuditContext::forSource(AuditSource::System);
    }

    private function product(Store $store, string $name, string $slug, ProductStatus $status = ProductStatus::Draft, bool $historic = false, ProductType $type = ProductType::Simple): Product
    {
        $product = new Product;
        $product->forceFill([
            'store_id' => $store->getKey(),
            ...CatalogDiscoveryKey::productAttributes($name),
            'slug' => $slug,
            'description' => "Synthetic plain-text description.\n<script>window.__productDescriptionExecuted = true</script>\nSecond line with <b>literal markup</b>.",
            'seo_title' => 'Synthetic catalog title',
            'seo_description' => 'Synthetic catalog description',
            'product_type' => $type,
            'requires_shipping' => $type === ProductType::Simple,
            'status' => $status,
            'published_at' => $status === ProductStatus::Published ? now()->subDay() : null,
            'created_at' => $historic ? now()->subYears(2) : now()->subDays(2),
            'updated_at' => now()->subDay(),
        ])->save();
        return $product;
    }

    private function variants(Store $store, Product $product): void
    {
        $now = now();
        $option = DB::table('catalog_product_options')->insertGetId([
            'store_id' => $store->getKey(), 'product_id' => $product->getKey(),
            'name' => 'Size', 'name_key' => 'size', 'position' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        // The cheapest active Variant has no stock. A different active Variant
        // supplies aggregate availability. Inactive cheaper stock must be ignored.
        foreach ([['Small', 10500, 0, 'active'], ['Large', 20500, 8, 'active'], ['Hidden', 100, 99, 'inactive']] as $index => [$value, $amount, $quantity, $status]) {
            $valueId = DB::table('catalog_product_option_values')->insertGetId([
                'store_id' => $store->getKey(), 'product_id' => $product->getKey(), 'option_id' => $option,
                'value' => $value, 'value_key' => strtolower($value), 'position' => $index,
                'created_at' => $now, 'updated_at' => $now,
            ]);
            $variant = DB::table('catalog_product_variants')->insertGetId([
                'store_id' => $store->getKey(), 'product_id' => $product->getKey(),
                'combination_key' => (string) $valueId, 'sku' => 'F3-VARIANT-'.$index, 'status' => $status,
                'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('catalog_variant_option_values')->insert([
                'store_id' => $store->getKey(), 'product_id' => $product->getKey(),
                'variant_id' => $variant, 'option_id' => $option, 'value_id' => $valueId,
                'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('pricing_variant_prices')->insert([
                'store_id' => $store->getKey(), 'product_id' => $product->getKey(), 'variant_id' => $variant,
                'amount_minor' => $amount, 'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('inventory_variant_stocks')->insert([
                'store_id' => $store->getKey(), 'product_id' => $product->getKey(), 'variant_id' => $variant,
                'quantity' => $quantity, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
    }

    public function seed(): array
    {
        if (User::query()->where('email', 'like', 'f3-%@example.test')->exists()) {
            throw new RuntimeException('F3 seed refuses existing fixtures; recreate the owned database for a fresh run.');
        }
        $public = [];
        $private = [];
        foreach (['browse', 'zero', 'denied', 'revocation', 'membership', 'identity', 'expiry'] as $group) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $member = $this->createIdentityUser(['email' => 'f3-'.$group.'@example.test', 'password' => $password, 'name' => 'F3 '.ucfirst($group)]);
            $stores = [];
            foreach (range(0, $group === 'browse' || $group === 'membership' ? 1 : 0) as $index) {
                $store = $this->activeMerchantStore($owner, 'F3 '.ucfirst($group).' Store '.($index + 1));
                $store->forceFill(['currency_code' => StoreCurrency::LYD])->save();
                $role = $this->createStoreRole($store, ['name' => $group === 'denied' ? 'Owner Administrator' : 'Catalog Reader']);
                $replacement = $this->createStoreRole($store, ['name' => 'Unprivileged Reader']);
                if ($group !== 'denied') $this->grantMerchantPermission($store, $role, 'products.view');
                if ($group === 'browse' && $index === 0) $this->grantMerchantPermission($store, $role, 'categories.view');
                $membership = $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
                $products = [];
                $category = null;
                if ($group !== 'zero') {
                    $category = new Category;
                    $category->forceFill(['store_id' => $store->getKey(), ...CatalogDiscoveryKey::categoryAttributes('Synthetic textiles'), 'slug' => 'synthetic-textiles', 'status' => CategoryStatus::Visible])->save();
                    $count = $group === 'browse' && $index === 0 ? 28 : 1;
                    for ($number = 1; $number <= $count; $number++) {
                        $name = sprintf('Atlas %02d %s', $number, $index === 0 ? 'Linen' : 'Store B Canary');
                        $product = $this->product($store, $name, 'atlas-'.$number, $number % 2 ? ProductStatus::Draft : ProductStatus::Published);
                        if ($number % 2 === 0) $product->categories()->attach($category->getKey(), ['store_id' => $store->getKey()]);
                        $products[] = ['id' => $product->public_id, 'name' => $name];
                        if ($number === 1) {
                            DB::table('pricing_product_prices')->insert(['store_id' => $store->getKey(), 'product_id' => $product->getKey(), 'amount_minor' => 12345, 'created_at' => now(), 'updated_at' => now()]);
                            DB::table('inventory_product_stocks')->insert(['store_id' => $store->getKey(), 'product_id' => $product->getKey(), 'quantity' => 7, 'created_at' => now(), 'updated_at' => now()]);
                        }
                    }
                    if ($group === 'browse' && $index === 0) {
                        $variant = $this->product($store, 'Variant Linen Set', 'variant-linen-set', ProductStatus::Published, false, ProductType::Variant);
                        $this->variants($store, $variant);
                        $historic = $this->product($store, 'Historical 2024 Canary', 'historical-canary', ProductStatus::Archived, true);
                        $public['variant'] = ['id' => $variant->public_id, 'name' => $variant->name];
                        $public['historic'] = ['id' => $historic->public_id, 'name' => $historic->name, 'from' => now()->subYears(2)->subDay()->format('Y-m-d'), 'to' => now()->subYears(2)->addDay()->format('Y-m-d')];
                    }
                }
                $stores[] = ['id' => $store->public_id, 'name' => $store->name, 'products' => $products, 'category' => $category?->public_id];
                if ($index === 0) $private[$group] = ['owner' => $owner->getKey(), 'member' => $member->getKey(), 'store' => $store->getKey(), 'membership' => $membership->getKey(), 'role' => $role->getKey(), 'replacement' => $replacement->getKey()];
            }
            $public[$group] = ['email' => $member->email, 'password' => $password, 'principalId' => $member->getKey(), 'stores' => $stores];
        }
        // Independent browser journeys use independent nonowner identities so
        // repeated test logins do not consume one user's published login limit.
        $public['readers'] = [];
        for ($index = 0; $index < 20; $index++) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $reader = $this->createIdentityUser(['email' => 'f3-reader-'.$index.'@example.test', 'password' => $password, 'name' => 'Synthetic Reader '.$index]);
            foreach ($public['browse']['stores'] as $publicStore) {
                $store = Store::query()->where('public_id', $publicStore['id'])->sole();
                $role = Role::queryForStore((int) $store->getKey())->where('name', 'Catalog Reader')->sole();
                $this->createStoreMembership($store, $reader, ['role_id' => $role->getKey()]);
            }
            $public['readers'][] = ['email' => $reader->email, 'password' => $password, 'stores' => $public['browse']['stores']];
        }
        $foreignStore = $this->activeMerchantStore($owner, 'Foreign Store Secret F3');
        $foreign = $this->product($foreignStore, 'Foreign Product Secret F3', 'foreign-secret');
        $public['foreign'] = ['id' => $foreign->public_id, 'name' => $foreign->name, 'storeName' => $foreignStore->name];
        foreach (['private' => $private, 'browser' => $public] as $name => $data) {
            file_put_contents('/tmp/f3-'.$name.'.json', json_encode($data, JSON_THROW_ON_ERROR));
            chmod('/tmp/f3-'.$name.'.json', 0600);
        }
        return ['seeded' => true, 'fixture_groups' => 7, 'browse_current_products' => 29];
    }

    public function change(string $group, string $change): array
    {
        $private = json_decode(file_get_contents('/tmp/f3-private.json'), true, flags: JSON_THROW_ON_ERROR);
        $ids = $private[$group] ?? throw new RuntimeException('Unknown fixture group.');
        $fixture = ['owner' => User::query()->findOrFail($ids['owner']), 'member' => User::query()->findOrFail($ids['member']), 'store' => Store::query()->findOrFail($ids['store']), 'membership' => StoreMembership::withoutGlobalScopes()->findOrFail($ids['membership']), 'role' => Role::withoutGlobalScopes()->findOrFail($ids['role']), 'replacement' => Role::withoutGlobalScopes()->findOrFail($ids['replacement'])];
        if ($change === 'products-permission') {
            app(InitializeTenantContextService::class)->execute(app(ResolveTenantFromMembershipService::class)->resolve($fixture['owner'], $fixture['store']->public_id));
            try {
                $ownerMembership = StoreMembership::queryForStore((int) $fixture['store']->getKey())->where('user_id', $fixture['owner']->getKey())->sole();
                app(RemovePermissionAction::class)->execute($ownerMembership, $fixture['role']->public_id, Permission::query()->where('slug', 'products.view')->sole()->public_id, $this->auditContext());
            } finally {
                app(DestroyTenantContextService::class)->execute();
            }
        } else {
            $this->changeMerchantAuthority($change, $fixture);
        }
        return ['changed' => $change, 'group' => $group];
    }
}

$fixtures = new FrontendProductFixtures;
$result = ($argv[1] ?? '') === 'seed' ? DB::transaction(fn () => $fixtures->seed()) : $fixtures->change($argv[1] ?? '', $argv[2] ?? '');
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
