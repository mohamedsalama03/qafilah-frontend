<?php

// Frontend-owned synthetic fixtures copied only into the disposable backend.
// Published models/actions are used without adding API routes or editing Laravel.
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
    throw new RuntimeException('F3B fixtures require the exact isolated local database.');
}

final class FrontendProductManagementFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext
    {
        return AuditContext::forSource(AuditSource::System);
    }

    private function category(Store $store, string $name, string $slug): Category
    {
        $category = new Category;
        $category->forceFill([
            'store_id' => $store->getKey(), ...CatalogDiscoveryKey::categoryAttributes($name),
            'slug' => $slug, 'status' => CategoryStatus::Visible,
        ])->save();
        return $category;
    }

    private function product(Store $store, string $name, string $slug, ProductStatus $status, Category $category): Product
    {
        $product = new Product;
        $product->forceFill([
            'store_id' => $store->getKey(), ...CatalogDiscoveryKey::productAttributes($name),
            'slug' => $slug, 'description' => "Synthetic management description.\nSecond plain-text line.",
            'seo_title' => 'Original SEO title', 'seo_description' => 'Original SEO description',
            'product_type' => ProductType::Simple, 'requires_shipping' => true,
            'status' => $status, 'published_at' => $status === ProductStatus::Published ? now()->subHour() : null,
        ])->save();
        $product->categories()->attach($category->getKey(), ['store_id' => $store->getKey()]);
        return $product;
    }

    public function seed(): array
    {
        if (User::query()->where('email', 'like', 'f3b-%@example.test')->exists()) {
            throw new RuntimeException('Management fixtures already exist; recreate only the owned database.');
        }
        $public = [];
        $private = [];
        $groups = [
            'create_simple', 'create_variant', 'validation', 'categories', 'edit', 'lifecycle',
            'denied', 'revocation_create', 'revocation_update', 'revocation_publish', 'foreign',
            'switch', 'logout', 'identity', 'unknown_create', 'unknown_update', 'unknown_lifecycle',
            'double_create', 'double_update', 'responsive', 'unsaved', 'no_categories', 'create_only',
        ];
        foreach ($groups as $group) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $member = $this->createIdentityUser(['email' => 'f3b-'.$group.'@example.test', 'password' => $password, 'name' => 'F3B '.str_replace('_', ' ', $group)]);
            $stores = [];
            foreach (range(0, in_array($group, ['switch', 'unsaved'], true) ? 1 : 0) as $index) {
                $store = $this->activeMerchantStore($owner, 'F3B '.str_replace('_', ' ', $group).' Store '.($index + 1));
                $store->forceFill(['currency_code' => StoreCurrency::LYD])->save();
                $role = $this->createStoreRole($store, ['name' => $group === 'denied' ? 'Owner Administrator' : 'Catalog Operator']);
                $replacement = $this->createStoreRole($store, ['name' => 'Unprivileged Reader']);
                if ($group !== 'create_only') $this->grantMerchantPermission($store, $role, 'products.view');
                if ($group === 'create_only') {
                    $this->grantMerchantPermission($store, $role, 'products.create');
                } elseif ($group !== 'denied') {
                    foreach (['products.create', 'products.update', 'products.publish'] as $permission) $this->grantMerchantPermission($store, $role, $permission);
                    if ($group !== 'no_categories') $this->grantMerchantPermission($store, $role, 'categories.view');
                }
                $membership = $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
                $categories = [
                    $this->category($store, 'Synthetic linen', 'synthetic-linen'),
                    $this->category($store, 'Synthetic canvas', 'synthetic-canvas'),
                ];
                $products = [];
                foreach (['draft' => ProductStatus::Draft, 'published' => ProductStatus::Published, 'archived' => ProductStatus::Archived] as $key => $status) {
                    $product = $this->product($store, 'F3B '.str_replace('_', ' ', $group).' '.$key.' '.($index + 1), str_replace('_', '-', $group).'-'.$key.'-'.($index + 1), $status, $categories[0]);
                    $products[$key] = ['id' => $product->public_id, 'name' => $product->name, 'slug' => $product->slug, 'status' => $status->value];
                }
                $stores[] = ['id' => $store->public_id, 'name' => $store->name, 'products' => $products, 'categories' => array_map(static fn (Category $category): array => ['id' => $category->public_id, 'name' => $category->name], $categories)];
                if ($index === 0) $private[$group] = ['owner' => $owner->getKey(), 'member' => $member->getKey(), 'store' => $store->getKey(), 'membership' => $membership->getKey(), 'role' => $role->getKey(), 'replacement' => $replacement->getKey()];
            }
            $public[$group] = ['email' => $member->email, 'password' => $password, 'stores' => $stores];
        }
        $foreignStore = $this->activeMerchantStore($owner, 'F3B Foreign Store Secret');
        $foreignCategory = $this->category($foreignStore, 'F3B Foreign Category Secret', 'foreign-category');
        $foreignProduct = $this->product($foreignStore, 'F3B Foreign Product Secret', 'foreign-product', ProductStatus::Draft, $foreignCategory);
        $public['foreignResource'] = ['store' => ['id' => $foreignStore->public_id, 'name' => $foreignStore->name], 'product' => ['id' => $foreignProduct->public_id, 'name' => $foreignProduct->name], 'category' => ['id' => $foreignCategory->public_id, 'name' => $foreignCategory->name]];
        foreach (['private' => $private, 'browser' => $public] as $name => $data) {
            file_put_contents('/tmp/f3b-'.$name.'.json', json_encode($data, JSON_THROW_ON_ERROR));
            chmod('/tmp/f3b-'.$name.'.json', 0600);
        }
        return ['seeded' => true, 'management_groups' => count($groups)];
    }

    public function change(string $group, string $change): array
    {
        $private = json_decode(file_get_contents('/tmp/f3b-private.json'), true, flags: JSON_THROW_ON_ERROR);
        $ids = $private[$group] ?? throw new RuntimeException('Unknown management fixture group.');
        $fixture = ['owner' => User::query()->findOrFail($ids['owner']), 'member' => User::query()->findOrFail($ids['member']), 'store' => Store::query()->findOrFail($ids['store']), 'membership' => StoreMembership::withoutGlobalScopes()->findOrFail($ids['membership']), 'role' => Role::withoutGlobalScopes()->findOrFail($ids['role']), 'replacement' => Role::withoutGlobalScopes()->findOrFail($ids['replacement'])];
        if (in_array($change, ['products.create', 'products.update', 'products.publish'], true)) {
            app(InitializeTenantContextService::class)->execute(app(ResolveTenantFromMembershipService::class)->resolve($fixture['owner'], $fixture['store']->public_id));
            try {
                $ownerMembership = StoreMembership::queryForStore((int) $fixture['store']->getKey())->where('user_id', $fixture['owner']->getKey())->sole();
                app(RemovePermissionAction::class)->execute($ownerMembership, $fixture['role']->public_id, Permission::query()->where('slug', $change)->sole()->public_id, $this->auditContext());
            } finally {
                app(DestroyTenantContextService::class)->execute();
            }
        } else {
            $this->changeMerchantAuthority($change, $fixture);
        }
        return ['changed' => $change, 'group' => $group];
    }
}

$fixtures = new FrontendProductManagementFixtures;
$result = ($argv[1] ?? '') === 'seed' ? DB::transaction(fn () => $fixtures->seed()) : $fixtures->change($argv[1] ?? '', $argv[2] ?? '');
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
