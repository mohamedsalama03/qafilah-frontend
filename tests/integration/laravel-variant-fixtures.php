<?php

// Frontend-owned synthetic data. Never execute against the canonical checkout/database.
use App\Modules\Auditing\Data\AuditContext;
use App\Modules\Auditing\Enums\AuditSource;
use App\Modules\Authorization\Actions\RemovePermissionAction;
use App\Modules\Authorization\Models\Permission;
use App\Modules\Authorization\Models\Role;
use App\Modules\Authorization\Models\StoreMembership;
use App\Modules\Catalog\Enums\ProductStatus;
use App\Modules\Catalog\Enums\ProductType;
use App\Modules\Catalog\Models\Product;
use App\Modules\Catalog\Models\ProductOption;
use App\Modules\Catalog\Models\ProductOptionValue;
use App\Modules\Catalog\Models\ProductVariant;
use App\Modules\Catalog\Services\CatalogDiscoveryKey;
use App\Modules\Identity\Models\User;
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
    throw new RuntimeException('Variant fixtures require the exact isolated local database.');
}

final class FrontendVariantFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext { return AuditContext::forSource(AuditSource::System); }

    private function option(Product $product, string $name, int $count = 2, int $position = 0): array
    {
        $option = new ProductOption;
        $option->forceFill(['store_id' => $product->store_id, 'product_id' => $product->getKey(), 'name' => $name, 'name_key' => mb_strtolower($name), 'position' => $position])->save();
        $values = [];
        foreach (range(1, $count) as $index) {
            $value = new ProductOptionValue;
            $label = $name.' '.$index;
            $value->forceFill(['store_id' => $product->store_id, 'product_id' => $product->getKey(), 'option_id' => $option->getKey(), 'value' => $label, 'value_key' => mb_strtolower($label), 'position' => $index])->save();
            $values[] = $value;
        }
        return [$option, $values];
    }

    private function variant(Product $product, array $values, ?string $sku = null, string $status = 'active'): ProductVariant
    {
        usort($values, fn ($a, $b) => $a->option_id <=> $b->option_id);
        $variant = new ProductVariant;
        $variant->forceFill(['store_id' => $product->store_id, 'product_id' => $product->getKey(), 'combination_key' => implode('.', array_map(fn ($v) => $v->getKey(), $values)), 'sku' => $sku, 'status' => $status])->save();
        foreach ($values as $value) $variant->values()->attach($value->getKey(), ['store_id' => $product->store_id, 'product_id' => $product->getKey(), 'option_id' => $value->option_id]);
        return $variant;
    }

    public function seed(): array
    {
        if (User::query()->where('email', 'like', 'f3d-%@example.test')->exists()) throw new RuntimeException('Variant fixture groups already exist.');
        $groups = ['workflow','permissions_none','permissions_view','permissions_create','permissions_update','permissions_view_create','permissions_view_update','validation','combinations','sku','limits','foreign','boundaries','revoke_view','revoke_create','revoke_update','switch_get','switch_write','product_get','product_write','principal_get','principal_write','committed','uncommitted','failed_review','partial','double_0','double_50','double_120','double_300','double_450','enter','malformed','refresh_failure','docker'];
        $public = []; $private = [];
        foreach ($groups as $group) {
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $password = bin2hex(random_bytes(24)).'!aA9';
            $member = $this->createIdentityUser(['email' => 'f3d-'.$group.'@example.test', 'password' => $password, 'name' => 'Variants '.str_replace('_', ' ', $group)]);
            $stores = [];
            foreach (range(0, str_starts_with($group, 'switch_') || $group === 'foreign' ? 1 : 0) as $index) {
                $store = $this->activeMerchantStore($owner, 'Variants '.str_replace('_', ' ', $group).' Store '.($index + 1));
                $role = $this->createStoreRole($store, ['name' => str_starts_with($group, 'permissions_') ? 'Owner Administrator' : 'Variant Operator']);
                $replacement = $this->createStoreRole($store, ['name' => 'No structural grants']);
                $this->grantMerchantPermission($store, $role, 'products.view');
                // Product CRUD grants intentionally do not establish structural authority.
                if ($group === 'permissions_none') foreach (['products.create','products.update'] as $grant) $this->grantMerchantPermission($store, $role, $grant);
                foreach (['view','create','update'] as $grant) {
                    if (!str_starts_with($group, 'permissions_') || str_contains(substr($group, 12), $grant)) $this->grantMerchantPermission($store, $role, 'products.variants.'.$grant);
                }
                $membership = $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
                $products = [];
                foreach (['empty','configured','other','simple','archived'] as $kind) {
                    $name = 'Variants '.str_replace('_', ' ', $group).' '.$kind.' '.($index + 1);
                    $product = new Product;
                    $product->forceFill(['store_id' => $store->getKey(), ...CatalogDiscoveryKey::productAttributes($name), 'slug' => str_replace('_','-',$group).'-'.$kind.'-'.($index+1), 'description' => 'Synthetic structural variant verification.', 'product_type' => $kind === 'simple' ? ProductType::Simple : ProductType::Variant, 'requires_shipping' => true, 'status' => ProductStatus::Draft])->save();
                    $options = []; $variants = [];
                    if (!in_array($kind, ['empty','simple'], true)) {
                        $count = $group === 'limits' && $kind === 'configured' ? 20 : 2;
                        [$option, $values] = $this->option($product, 'Size', $count);
                        $options[] = ['id'=>$option->public_id,'name'=>$option->name,'values'=>array_map(fn($v)=>['id'=>$v->public_id,'value'=>$v->value],$values)];
                        if ($group === 'limits' && $kind === 'configured') {
                            [$second, $secondValues] = $this->option($product, 'Color', 6, 1);
                            [$third, $thirdValues] = $this->option($product, 'Material', 1, 2);
                            foreach ([[$second,$secondValues],[$third,$thirdValues]] as [$o,$vs]) $options[] = ['id'=>$o->public_id,'name'=>$o->name,'values'=>array_map(fn($v)=>['id'=>$v->public_id,'value'=>$v->value],$vs)];
                            for ($n=0;$n<100;$n++) $variants[] = $this->variant($product,[$values[$n%20],$secondValues[intdiv($n,20)],$thirdValues[0]],null,$n%2===0?'active':'inactive')->public_id;
                        } else $variants[] = $this->variant($product,[$values[0]],$group.'-'.$kind.'-'.$index)->public_id;
                    }
                    if ($kind === 'archived') $product->forceFill(['status'=>ProductStatus::Archived])->save();
                    $products[$kind] = ['id'=>$product->public_id,'name'=>$name,'options'=>$options,'variants'=>$variants];
                }
                $stores[] = ['id'=>$store->public_id,'name'=>$store->name,'products'=>$products];
                if ($index===0) $private[$group] = ['owner'=>$owner->getKey(),'member'=>$member->getKey(),'store'=>$store->getKey(),'membership'=>$membership->getKey(),'role'=>$role->getKey(),'replacement'=>$replacement->getKey()];
            }
            $public[$group]=['email'=>$member->email,'password'=>$password,'stores'=>$stores];
        }
        foreach (['private'=>$private,'browser'=>$public] as $name=>$data) { file_put_contents('/tmp/f3d-'.$name.'.json',json_encode($data,JSON_THROW_ON_ERROR)); chmod('/tmp/f3d-'.$name.'.json',0600); }
        return ['seeded'=>true,'variant_groups'=>count($groups)];
    }

    public function control(string $group, string $change): array
    {
        $ids=json_decode(file_get_contents('/tmp/f3d-private.json'),true,flags:JSON_THROW_ON_ERROR)[$group] ?? throw new RuntimeException('Unknown fixture group.');
        $fixture=['owner'=>User::query()->findOrFail($ids['owner']),'member'=>User::query()->findOrFail($ids['member']),'store'=>Store::query()->findOrFail($ids['store']),'membership'=>StoreMembership::withoutGlobalScopes()->findOrFail($ids['membership']),'role'=>Role::withoutGlobalScopes()->findOrFail($ids['role']),'replacement'=>Role::withoutGlobalScopes()->findOrFail($ids['replacement'])];
        if (in_array($change,['products.variants.view','products.variants.create','products.variants.update'],true)) {
            app(InitializeTenantContextService::class)->execute(app(ResolveTenantFromMembershipService::class)->resolve($fixture['owner'],$fixture['store']->public_id));
            try { $ownerMembership=StoreMembership::queryForStore($ids['store'])->where('user_id',$ids['owner'])->sole(); app(RemovePermissionAction::class)->execute($ownerMembership,$fixture['role']->public_id,Permission::query()->where('slug',$change)->sole()->public_id,$this->auditContext()); }
            finally { app(DestroyTenantContextService::class)->execute(); }
        } else $this->changeMerchantAuthority($change,$fixture);
        return ['changed'=>$change,'group'=>$group];
    }
}
$fixtures=new FrontendVariantFixtures;
$result=($argv[1]??'')==='seed'?DB::transaction(fn()=>$fixtures->seed()):$fixtures->control($argv[1]??'',$argv[2]??'');
echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
