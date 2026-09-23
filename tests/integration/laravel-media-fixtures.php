<?php

// Frontend-owned synthetic fixtures; never execute in the canonical backend/database.
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
    throw new RuntimeException('Media fixtures require the exact isolated local database.');
}

final class FrontendMediaFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext { return AuditContext::forSource(AuditSource::System); }

    public function seed(): array
    {
        if (User::query()->where('email', 'like', 'f3f-%@example.test')->exists()) throw new RuntimeException('Media fixture groups already exist.');
        $groups = ['crud_product', 'crud_variant', 'validation', 'limits', 'permissions_create_only', 'permissions_update_only', 'permissions_delete_only', 'permissions_none', 'permissions_view', 'permissions_create', 'permissions_update', 'permissions_delete', 'permissions_all', 'no_product', 'no_variant', 'inactive', 'archived', 'foreign', 'revoke_view', 'revoke_create', 'revoke_update', 'revoke_delete', 'committed_post', 'uncommitted_post', 'committed_patch', 'uncommitted_patch', 'committed_delete', 'uncommitted_delete', 'failed_review', 'refresh_failure', 'remount', 'responsive', 'persistence', 'unsafe', 'production', 'enter', 'switch_get', 'switch_post', 'switch_patch', 'switch_delete', 'product_get', 'product_post', 'product_patch', 'product_delete', 'variant_get', 'variant_post', 'variant_patch', 'variant_delete', 'principal_get', 'principal_post', 'principal_patch', 'principal_delete', 'double_0', 'double_50', 'double_120', 'double_300', 'double_450'];
        $public = []; $private = [];
        foreach ($groups as $group) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $member = $this->createIdentityUser(['email' => 'f3f-'.$group.'@example.test', 'password' => $password, 'name' => 'Media '.str_replace('_',' ',$group)]);
            $stores = [];
            foreach (range(0, str_starts_with($group,'switch_') || $group === 'foreign' ? 1 : 0) as $index) {
                $store = $this->activeMerchantStore($owner, 'Media '.str_replace('_',' ',$group).' Store '.($index+1));
                $role = $this->createStoreRole($store, ['name'=>'Owner Administrator']);
                $replacement = $this->createStoreRole($store, ['name'=>'No grants']);
                if ($group !== 'no_product') $this->grantMerchantPermission($store,$role,'products.view');
                if ($group !== 'no_variant') $this->grantMerchantPermission($store,$role,'products.variants.view');
                foreach (['view','create','update','delete'] as $verb) {
                    if (!str_starts_with($group,'permissions_') || $group === 'permissions_all' || $group === 'permissions_'.$verb || $group === 'permissions_'.$verb.'_only' || ($verb==='view' && in_array($group,['permissions_create','permissions_update','permissions_delete'],true))) $this->grantMerchantPermission($store,$role,'products.media.'.$verb);
                }
                // Unrelated Product/Variant grants and the Role name confer no media authority.
                foreach (['products.update','products.inventory.update','products.variants.update'] as $grant) $this->grantMerchantPermission($store,$role,$grant);
                $membership = $this->createStoreMembership($store,$member,['role_id'=>$role->getKey()]);
                $products = [];
                foreach (['main','other','archived','simple'] as $kind) {
                    $name = 'Media '.str_replace('_',' ',$group).' '.$kind.' '.($index+1);
                    $product = new Product;
                    $product->forceFill(['store_id'=>$store->getKey(),...CatalogDiscoveryKey::productAttributes($name),'slug'=>str_replace('_','-',$group).'-'.$kind.'-'.($index+1),'description'=>'Synthetic Media verification.','product_type'=>$kind==='simple'?ProductType::Simple:ProductType::Variant,'requires_shipping'=>true,'status'=>ProductStatus::Draft])->save();
                    $variants = [];
                    if ($kind !== 'simple') {
                        $option = new ProductOption;
                        $option->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'name'=>'Size','name_key'=>'size','position'=>0])->save();
                        foreach (['first','second','inactive'] as $position=>$label) {
                            $value = new ProductOptionValue;
                            $value->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'option_id'=>$option->getKey(),'value'=>$label,'value_key'=>$label,'position'=>$position])->save();
                            $variant = new ProductVariant;
                            $variant->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'combination_key'=>(string)$value->getKey(),'sku'=>$group.'-'.$kind.'-'.$index.'-'.$label,'status'=>$label==='inactive'?'inactive':'active'])->save();
                            $variant->values()->attach($value->getKey(),['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'option_id'=>$option->getKey()]);
                            $variants[$label] = $variant->public_id;
                            if ($kind === 'main' && $label === 'first' && $index===0) $target=['product'=>$product->getKey(),'variant'=>$variant->getKey()];
                        }
                    }
                    if ($kind === 'archived') $product->forceFill(['status'=>ProductStatus::Archived])->save();
                    $assets=[];
                    if (!in_array($group,['crud_product','crud_variant','validation','limits','responsive','persistence','production'],true)) {
                        $assets['product']=$this->image($store,$product,null,'Existing product image');
                        foreach ($variants as $label=>$publicId) $assets[$label]=$this->image($store,$product,ProductVariant::withoutGlobalScopes()->where('public_id',$publicId)->sole(),'Existing '.$label.' image');
                    }
                    $products[$kind]=['id'=>$product->public_id,'name'=>$name,'variants'=>$variants,'assets'=>$assets];
                }
                $stores[]=['id'=>$store->public_id,'name'=>$store->name,'products'=>$products];
                if ($index===0) $private[$group]=['owner'=>$owner->getKey(),'member'=>$member->getKey(),'store'=>$store->getKey(),'membership'=>$membership->getKey(),'role'=>$role->getKey(),'replacement'=>$replacement->getKey(),...$target];
            }
            $public[$group]=['email'=>$member->email,'password'=>$password,'stores'=>$stores];
        }
        foreach (['private'=>$private,'browser'=>$public] as $name=>$data) { file_put_contents('/tmp/f3f-'.$name.'.json',json_encode($data,JSON_THROW_ON_ERROR)); chmod('/tmp/f3f-'.$name.'.json',0600); }
        return ['seeded'=>true,'media_groups'=>count($groups)];
    }

    private function image(Store $store, Product $product, ?ProductVariant $variant, string $alt): string
    {
        $key='catalog/'.Illuminate\Support\Str::uuid();
        Illuminate\Support\Facades\Storage::disk('public')->put($key,base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwLo4FAAIoARzihMzaAAAAAElFTkSuQmCC'));
        $asset=new App\Modules\Catalog\Models\MediaAsset;
        $asset->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'association_kind'=>$variant?'variant':'product','disk'=>'public','storage_key'=>$key,'mime_type'=>'image/png','byte_size'=>Illuminate\Support\Facades\Storage::disk('public')->size($key),'width'=>1,'height'=>1])->save();
        $association=$variant?new App\Modules\Catalog\Models\VariantMedia:new App\Modules\Catalog\Models\ProductMedia;
        $association->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'asset_id'=>$asset->getKey(),'association_kind'=>$variant?'variant':'product','position'=>0,'alt_text'=>$alt,...($variant?['variant_id'=>$variant->getKey()]:['is_primary'=>true])])->save();
        return $asset->public_id;
    }

    public function control(string $group,string $change): array
    {
        $ids=json_decode(file_get_contents('/tmp/f3f-private.json'),true,flags:JSON_THROW_ON_ERROR)[$group]??throw new RuntimeException('Unknown fixture group.');
        $fixture=['owner'=>User::query()->findOrFail($ids['owner']),'member'=>User::query()->findOrFail($ids['member']),'store'=>Store::query()->findOrFail($ids['store']),'membership'=>StoreMembership::withoutGlobalScopes()->findOrFail($ids['membership']),'role'=>Role::withoutGlobalScopes()->findOrFail($ids['role']),'replacement'=>Role::withoutGlobalScopes()->findOrFail($ids['replacement'])];
        if (in_array($change,['products.media.view','products.media.create','products.media.update','products.media.delete'],true)) {
            app(InitializeTenantContextService::class)->execute(app(ResolveTenantFromMembershipService::class)->resolve($fixture['owner'],$fixture['store']->public_id));
            try { $ownerMembership=StoreMembership::queryForStore($ids['store'])->where('user_id',$ids['owner'])->sole(); app(RemovePermissionAction::class)->execute($ownerMembership,$fixture['role']->public_id,Permission::query()->where('slug',$change)->sole()->public_id,$this->auditContext()); }
            finally { app(DestroyTenantContextService::class)->execute(); }
        } else $this->changeMerchantAuthority($change,$fixture);
        return ['changed'=>$change,'group'=>$group];
    }
}
$fixtures=new FrontendMediaFixtures;
$result=($argv[1]??'')==='seed'?DB::transaction(fn()=>$fixtures->seed()):$fixtures->control($argv[1]??'',$argv[2]??'');
echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
