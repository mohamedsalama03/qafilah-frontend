<?php

// Synthetic frontend-owned fixtures. Refuse every database except the disposable test topology.
use App\Modules\Authorization\Models\Role;
use App\Modules\Catalog\Enums\ProductType;
use App\Modules\Catalog\Models\Product;
use App\Modules\Catalog\Models\ProductOption;
use App\Modules\Catalog\Models\ProductOptionValue;
use App\Modules\Catalog\Models\ProductVariant;
use App\Modules\Catalog\Services\CatalogDiscoveryKey;
use App\Modules\Identity\Models\User;
use App\Modules\Stores\Enums\StoreStatus;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesMerchantContext;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (app()->environment() !== 'local' || DB::selectOne('select current_database() as name')->name !== 'qafilah_f2_isolated') throw new RuntimeException('Requires isolated local Pricing database.');

final class FrontendPricingFixtures
{
    use CreatesMerchantContext;
    public function seed(): array
    {
        if (User::query()->where('email','like','f3g-price-%@example.test')->exists()) throw new RuntimeException('Pricing fixtures already exist.');
        $groups=['LYD','USD','EUR','null','validation','projection','archived','foreign','permissions','committed_product','uncommitted_product','committed_variant','uncommitted_variant','failed_review','revoked','refresh','double','races','responsive'];
        foreach(['Store','Product','Variant','principal','authority'] as $boundary)foreach(['GET','PATCH']as $method)$groups[]='race_'.strtolower($boundary).'_'.strtolower($method);
        $browser=[];$private=[];
        foreach($groups as $group) {
            $password=bin2hex(random_bytes(24)).'!aA9';
            $owner=$this->createIdentityUser();
            $member=$this->createIdentityUser(['email'=>'f3g-price-'.strtolower($group).'@example.test','password'=>$password,'name'=>'Pricing '.str_replace('_',' ',$group)]);
            $stores=[];
            foreach(range(0,(str_starts_with($group,'race_')||in_array($group,['races','foreign'],true))?1:0) as $index) {
                $currency=$group==='null'?null:(in_array($group,['LYD','USD','EUR'],true)?$group:'LYD');
                $store=$this->createStore($owner,['name'=>'Pricing '.$group.' Store '.($index+1),'status'=>StoreStatus::Active,'activated_at'=>now(),'currency_code'=>$currency]);
                $role=$this->createStoreRole($store,['name'=>'Arbitrary role label']);
                foreach(['products.view','products.price.update','products.variants.view','products.variants.price.update','products.variants.update','products.variants.inventory.update'] as $grant) $this->grantMerchantPermission($store,$role,$grant);
                $this->createStoreMembership($store,$member,['role_id'=>$role->getKey()]);
                $products=[];
                foreach(['simple','other','variant','other_variant','archived'] as $kind) {
                    $variantType=in_array($kind,['variant','other_variant'],true);
                    $name='Pricing '.$group.' '.$index.' '.$kind;
                    $product=new Product;
                    $product->forceFill(['store_id'=>$store->getKey(),...CatalogDiscoveryKey::productAttributes($name),'slug'=>str_replace('_','-','price-'.strtolower($group).'-'.$index.'-'.$kind),'description'=>'Synthetic pricing fixture.','product_type'=>$variantType?ProductType::Variant:ProductType::Simple,'status'=>'draft'])->save();
                    $variants=[];
                    if($variantType) {
                        $option=new ProductOption;
                        $option->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'name'=>'Size','name_key'=>'size','position'=>0])->save();
                        foreach(['first','second','inactive'] as $position=>$label) {
                            $value=new ProductOptionValue;
                            $value->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'option_id'=>$option->getKey(),'value'=>$label,'value_key'=>$label,'position'=>$position])->save();
                            $variant=new ProductVariant;
                            $variant->forceFill(['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'combination_key'=>(string)$value->getKey(),'status'=>$label==='inactive'?'inactive':'active'])->save();
                            $variant->values()->attach($value->getKey(),['store_id'=>$store->getKey(),'product_id'=>$product->getKey(),'option_id'=>$option->getKey()]);
                            $variants[$label]=$variant->public_id;
                        }
                    }
                    if($kind==='archived')$product->forceFill(['status'=>'archived'])->save();
                    $products[$kind]=['id'=>$product->public_id,'name'=>$name,'variants'=>$variants];
                }
                $stores[]=['id'=>$store->public_id,'name'=>$store->name,'currency'=>$currency,'products'=>$products];
                if($index===0)$private[$group]=['role'=>$role->getKey(),'store'=>$store->getKey(),'member'=>$member->getKey()];
            }
            $browser[$group]=['email'=>$member->email,'password'=>$password,'stores'=>$stores];
        }
        foreach(['browser'=>$browser,'private'=>$private]as $name=>$value){file_put_contents('/tmp/f3g-pricing-'.$name.'.json',json_encode($value,JSON_THROW_ON_ERROR));chmod('/tmp/f3g-pricing-'.$name.'.json',0600);}
        return ['groups'=>count($groups)];
    }
    public function permissions(string $group,string $mask):array
    {
        $ids=json_decode(file_get_contents('/tmp/f3g-pricing-private.json'),true,flags:JSON_THROW_ON_ERROR)[$group]??throw new RuntimeException('Unknown group.');
        $store=App\Modules\Stores\Models\Store::findOrFail($ids['store']);
        $role=Role::withoutGlobalScopes()->findOrFail($ids['role']);
        $role->permissions()->detach();
        foreach(explode(',',$mask)as $grant)if($grant!=='')$this->grantMerchantPermission($store,$role,$grant);
        return ['updated'=>true];
    }
}
$fixture=new FrontendPricingFixtures;
echo json_encode(DB::transaction(fn()=>($argv[1]??'')==='seed'?$fixture->seed():$fixture->permissions($argv[1]??'',$argv[2]??'')),JSON_THROW_ON_ERROR).PHP_EOL;
