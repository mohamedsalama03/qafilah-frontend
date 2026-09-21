<?php

// Frontend-owned synthetic fixtures. Execute only in the disposable published image.
use App\Modules\Auditing\Contracts\RecordsAuditEntries;
use App\Modules\Auditing\Data\AuditContext;
use App\Modules\Auditing\Data\AuditEntry;
use App\Modules\Auditing\Enums\AuditSource;
use App\Modules\Authorization\Actions\RemovePermissionAction;
use App\Modules\Authorization\Models\Permission;
use App\Modules\Authorization\Models\Role;
use App\Modules\Authorization\Models\StoreMembership;
use App\Modules\Catalog\Enums\ProductStatus;
use App\Modules\Catalog\Enums\ProductType;
use App\Modules\Catalog\Models\Product;
use App\Modules\Catalog\Services\CatalogDiscoveryKey;
use App\Modules\Catalog\Services\CatalogMutationGuard;
use App\Modules\Identity\Models\User;
use App\Modules\Inventory\Actions\UpdateProductInventoryAction;
use App\Modules\Inventory\Contracts\DeductsInventory;
use App\Modules\Inventory\Data\InventoryDeductionData;
use App\Modules\Inventory\DTOs\UpdateProductInventoryData;
use App\Modules\Inventory\Models\ProductStock;
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
    throw new RuntimeException('Inventory fixtures require the exact isolated local database.');
}

final class FrontendInventoryFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext
    {
        return AuditContext::forSource(AuditSource::System);
    }

    public function seed(): array
    {
        if (User::query()->where('email', 'like', 'f3c-%@example.test')->exists()) {
            throw new RuntimeException('Inventory fixtures already exist; recreate only the owned database.');
        }
        $groups = ['states', 'validation', 'readonly', 'writeonly', 'foreign', 'archived', 'variant', 'revoke_read', 'revoke_write', 'store_loss', 'membership_loss', 'identity_loss', 'logout', 'switch_get', 'switch_patch', 'principal_get', 'principal_patch', 'committed', 'uncommitted', 'failed_review', 'intervening', 'refresh_failure', 'malformed', 'server_error', 'transaction', 'responsive', 'double_0', 'double_50', 'double_120', 'double_300', 'double_450', 'enter', 'remount', 'docker'];
        $public = [];
        $private = [];
        foreach ($groups as $group) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $member = $this->createIdentityUser(['email' => 'f3c-'.$group.'@example.test', 'password' => $password, 'name' => 'Inventory '.str_replace('_', ' ', $group)]);
            $stores = [];
            foreach (range(0, str_starts_with($group, 'switch_') ? 1 : 0) as $index) {
                $store = $this->activeMerchantStore($owner, 'Inventory '.str_replace('_', ' ', $group).' Store '.($index + 1));
                $role = $this->createStoreRole($store, ['name' => $group === 'readonly' ? 'Owner Administrator' : 'Inventory Operator']);
                $replacement = $this->createStoreRole($store, ['name' => 'No inventory grants']);
                if ($group !== 'writeonly') $this->grantMerchantPermission($store, $role, 'products.view');
                if ($group !== 'readonly') $this->grantMerchantPermission($store, $role, 'products.inventory.update');
                $membership = $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
                $products = [];
                foreach (['simple', 'archived', 'variant'] as $kind) {
                    $name = 'Inventory '.str_replace('_', ' ', $group).' '.$kind.' '.($index + 1);
                    $product = new Product;
                    $product->forceFill([
                        'store_id' => $store->getKey(), ...CatalogDiscoveryKey::productAttributes($name),
                        'slug' => str_replace('_', '-', $group).'-'.$kind.'-'.($index + 1),
                        'description' => 'Synthetic inventory verification product.',
                        'product_type' => $kind === 'variant' ? ProductType::Variant : ProductType::Simple,
                        'requires_shipping' => true,
                        'status' => $kind === 'archived' ? ProductStatus::Archived : ProductStatus::Draft,
                    ])->save();
                    $products[$kind] = ['id' => $product->public_id, 'name' => $name];
                    if ($kind === 'simple' && ($index === 1 || in_array($group, ['uncommitted', 'failed_review', 'transaction', 'readonly'], true))) {
                        (new ProductStock)->forceFill(['store_id' => $store->getKey(), 'product_id' => $product->getKey(), 'quantity' => $index === 1 ? 37 : 3])->save();
                    }
                    if ($kind === 'simple' && $index === 0) $productId = $product->getKey();
                }
                $stores[] = ['id' => $store->public_id, 'name' => $store->name, 'products' => $products];
                if ($index === 0) $private[$group] = ['owner' => $owner->getKey(), 'member' => $member->getKey(), 'store' => $store->getKey(), 'membership' => $membership->getKey(), 'role' => $role->getKey(), 'replacement' => $replacement->getKey(), 'product' => $productId];
            }
            $public[$group] = ['email' => $member->email, 'password' => $password, 'stores' => $stores];
        }
        foreach (['private' => $private, 'browser' => $public] as $name => $data) {
            file_put_contents('/tmp/f3c-'.$name.'.json', json_encode($data, JSON_THROW_ON_ERROR));
            chmod('/tmp/f3c-'.$name.'.json', 0600);
        }
        return ['seeded' => true, 'inventory_groups' => count($groups)];
    }

    public function control(string $group, string $change): array
    {
        $ids = json_decode(file_get_contents('/tmp/f3c-private.json'), true, flags: JSON_THROW_ON_ERROR)[$group] ?? throw new RuntimeException('Unknown inventory fixture group.');
        $fixture = ['owner' => User::query()->findOrFail($ids['owner']), 'member' => User::query()->findOrFail($ids['member']), 'store' => Store::query()->findOrFail($ids['store']), 'membership' => StoreMembership::withoutGlobalScopes()->findOrFail($ids['membership']), 'role' => Role::withoutGlobalScopes()->findOrFail($ids['role']), 'replacement' => Role::withoutGlobalScopes()->findOrFail($ids['replacement'])];
        if ($change === 'deduct_one') {
            DB::transaction(fn () => app(DeductsInventory::class)->deduct($ids['store'], [new InventoryDeductionData($ids['product'], null, 1)]));
            return ['quantity' => ProductStock::withoutGlobalScopes()->where('product_id', $ids['product'])->sole()->quantity];
        }
        if ($change === 'audit_rollback') {
            app(InitializeTenantContextService::class)->execute(app(ResolveTenantFromMembershipService::class)->resolve($fixture['member'], $fixture['store']->public_id));
            try {
                $stock = fn () => ProductStock::queryForStore($ids['store'])->where('product_id', $ids['product'])->sole()->quantity;
                $before = $stock();
                $writer = new class implements RecordsAuditEntries {
                    public function record(AuditEntry $entry): void { throw new RuntimeException('Synthetic audit failure.'); }
                };
                $failed = false;
                $product = Product::queryForStore($ids['store'])->findOrFail($ids['product']);
                $request = Illuminate\Http\Request::create('http://localhost/api/v1/stores/'.$fixture['store']->public_id.'/catalog/products/'.$product->public_id.'/inventory', 'PATCH');
                $request->attributes->set(App\Support\Http\Middleware\RequestId::ATTRIBUTE, (string) Illuminate\Support\Str::uuid());
                $context = AuditContext::fromHttpRequest($request);
                try {
                    (new UpdateProductInventoryAction(app(CatalogMutationGuard::class), $writer))->execute($fixture['membership'], $product->public_id, new UpdateProductInventoryData(912), $context);
                } catch (RuntimeException $error) {
                    if ($error->getMessage() !== 'Synthetic audit failure.') throw $error;
                    $failed = true;
                }
                return ['auditFailureReached' => $failed, 'before' => $before, 'after' => $stock()];
            } finally { app(DestroyTenantContextService::class)->execute(); }
        }
        if (in_array($change, ['products.view', 'products.inventory.update'], true)) {
            app(InitializeTenantContextService::class)->execute(app(ResolveTenantFromMembershipService::class)->resolve($fixture['owner'], $fixture['store']->public_id));
            try {
                $ownerMembership = StoreMembership::queryForStore($ids['store'])->where('user_id', $ids['owner'])->sole();
                app(RemovePermissionAction::class)->execute($ownerMembership, $fixture['role']->public_id, Permission::query()->where('slug', $change)->sole()->public_id, $this->auditContext());
            } finally { app(DestroyTenantContextService::class)->execute(); }
        } else $this->changeMerchantAuthority($change, $fixture);
        return ['changed' => $change, 'group' => $group];
    }
}

$fixtures = new FrontendInventoryFixtures;
$result = ($argv[1] ?? '') === 'seed' ? DB::transaction(fn () => $fixtures->seed()) : $fixtures->control($argv[1] ?? '', $argv[2] ?? '');
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
