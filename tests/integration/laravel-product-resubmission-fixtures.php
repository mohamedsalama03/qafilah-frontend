<?php

// Frontend-owned synthetic data, executed only in the disposable published image.
use App\Modules\Auditing\Data\AuditContext;
use App\Modules\Auditing\Enums\AuditSource;
use App\Modules\Catalog\Enums\ProductStatus;
use App\Modules\Catalog\Enums\ProductType;
use App\Modules\Catalog\Models\Product;
use App\Modules\Catalog\Services\CatalogDiscoveryKey;
use App\Modules\Identity\Models\User;
use App\Modules\Stores\Enums\StoreCurrency;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesMerchantContext;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (app()->environment() !== 'local' || DB::selectOne('select current_database() as name')->name !== 'qafilah_f2_isolated') {
    throw new RuntimeException('Resubmission fixtures require the exact isolated local database.');
}

final class FrontendProductResubmissionFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext
    {
        return AuditContext::forSource(AuditSource::System);
    }

    public function seed(): array
    {
        if (User::query()->where('email', 'like', 'f3br-%@example.test')->exists()) {
            throw new RuntimeException('Resubmission fixtures exist; recreate only the owned database.');
        }
        $groups = ['boundary_create', 'boundary_save', 'future_create', 'future_save', 'future_lifecycle', 'fresh_boundary_create', 'fresh_boundary_save', 'leave_during_review', 'external_update'];
        foreach (['publish', 'unpublish', 'archive', 'create', 'save'] as $operation) {
            foreach ([0, 50, 120, 200, 300, 450] as $interval) $groups[] = $operation.'_'.$interval;
        }
        $public = [];
        foreach ($groups as $group) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $member = $this->createIdentityUser(['email' => 'f3br-'.$group.'@example.test', 'password' => $password, 'name' => 'Resubmission '.str_replace('_', ' ', $group)]);
            $store = $this->activeMerchantStore($owner, 'Resubmission '.str_replace('_', ' ', $group));
            $store->forceFill(['currency_code' => StoreCurrency::LYD])->save();
            $role = $this->createStoreRole($store, ['name' => 'Product Operator']);
            foreach ($group === 'future_create' ? ['products.create'] : ['products.view', 'products.create', 'products.update', 'products.publish', 'categories.view'] as $permission) {
                $this->grantMerchantPermission($store, $role, $permission);
            }
            $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
            $products = [];
            foreach (['draft' => ProductStatus::Draft, 'published' => ProductStatus::Published] as $key => $status) {
                $name = 'Resubmission '.str_replace('_', ' ', $group).' '.$key;
                $product = new Product;
                $product->forceFill([
                    'store_id' => $store->getKey(), ...CatalogDiscoveryKey::productAttributes($name),
                    'slug' => str_replace('_', '-', $group).'-'.$key,
                    'description' => 'Synthetic response-boundary fixture.',
                    'product_type' => ProductType::Simple, 'requires_shipping' => true,
                    'status' => $status, 'published_at' => $status === ProductStatus::Published ? now()->subHour() : null,
                ])->save();
                $products[$key] = ['id' => $product->public_id, 'name' => $product->name, 'slug' => $product->slug, 'status' => $status->value];
            }
            $public[$group] = ['email' => $member->email, 'password' => $password, 'store' => ['id' => $store->public_id, 'name' => $store->name, 'products' => $products]];
        }
        file_put_contents('/tmp/f3br-browser.json', json_encode($public, JSON_THROW_ON_ERROR));
        chmod('/tmp/f3br-browser.json', 0600);
        return ['seeded' => true, 'resubmission_groups' => count($groups)];
    }
}

if (($argv[1] ?? '') !== 'seed') throw new RuntimeException('Only synthetic seed is supported.');
echo json_encode(DB::transaction(fn () => (new FrontendProductResubmissionFixtures)->seed()), JSON_THROW_ON_ERROR).PHP_EOL;
