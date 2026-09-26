<?php

// Frontend-owned fixtures for a disposable copy of either certified backend.
// Never execute against a real Store database or modify a backend checkout.
use App\Modules\Catalog\Enums\ProductStatus;
use App\Modules\Catalog\Enums\ProductType;
use App\Modules\Catalog\Models\Product;
use App\Modules\Catalog\Services\CatalogDiscoveryKey;
use App\Modules\Identity\Models\User;
use App\Modules\Stores\Enums\StoreCurrency;
use App\Modules\Stores\Enums\StoreStatus;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesMerchantContext;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (app()->environment() !== 'local' || DB::selectOne('select current_database() as name')->name !== 'qafilah_f2_isolated') {
    throw new RuntimeException('Currency fixtures require the disposable local integration database.');
}

final class StoreCurrencyCompatibilityFixtures
{
    use CreatesMerchantContext;

    public function seed(): void
    {
        if (User::query()->where('email', 'f3g-compat@example.test')->exists()) {
            throw new RuntimeException('Refuse to reseed existing compatibility fixtures.');
        }
        $owner = $this->createIdentityUser();
        $password = bin2hex(random_bytes(24)).'!aA9';
        $member = $this->createIdentityUser(['email' => 'f3g-compat@example.test', 'password' => $password]);
        $stores = [];
        foreach ([StoreCurrency::LYD, StoreCurrency::USD, StoreCurrency::EUR, null] as $index => $currency) {
            $store = $this->createStore($owner, [
                'name' => 'Compatibility Store '.($index + 1), 'status' => StoreStatus::Active,
                'activated_at' => now(), 'currency_code' => $currency,
            ]);
            $role = $this->createStoreRole($store, ['name' => 'Arbitrary role label']);
            $this->grantMerchantPermission($store, $role, 'products.view');
            $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
            $name = 'Compatibility Product '.($index + 1);
            $product = new Product;
            $product->forceFill([
                'store_id' => $store->getKey(), ...CatalogDiscoveryKey::productAttributes($name),
                'slug' => 'compatibility-product-'.($index + 1), 'description' => 'Isolated compatibility fixture.',
                'product_type' => ProductType::Simple, 'status' => ProductStatus::Draft,
            ])->save();
            $stores[] = ['id' => $store->public_id, 'name' => $store->name, 'currency' => $currency?->value,
                'product' => ['id' => $product->public_id, 'name' => $name]];
        }
        file_put_contents('/tmp/f3g-browser.json', json_encode(['email' => $member->email, 'password' => $password, 'stores' => $stores], JSON_THROW_ON_ERROR));
        chmod('/tmp/f3g-browser.json', 0600);
    }
}
DB::transaction(fn () => (new StoreCurrencyCompatibilityFixtures)->seed());
echo "Compatibility fixtures seeded: four nonowner Stores.\n";
