<?php

// Frontend-owned test control, copied only into the disposable backend container.
// Reuses the published backend's fixtures/actions; never serves HTTP or changes its checkout.
use App\Modules\Auditing\Data\AuditContext;
use App\Modules\Auditing\Enums\AuditSource;
use App\Modules\Authorization\Models\Role;
use App\Modules\Authorization\Models\StoreMembership;
use App\Modules\Identity\Models\User;
use App\Modules\Stores\Models\Store;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesMerchantContext;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (app()->environment() !== 'local' || DB::selectOne('select current_database() as name')->name !== 'qafilah_f2_isolated') {
    throw new RuntimeException('F2 fixture control requires its isolated local database.');
}

final class FrontendIntegrationFixtures
{
    use CreatesMerchantContext;

    protected function auditContext(): AuditContext
    {
        return AuditContext::forSource(AuditSource::System);
    }

    public function seed(): array
    {
        if (User::query()->exists()) {
            throw new RuntimeException('Seed requires an empty isolated database.');
        }
        $public = [];
        $private = [];
        foreach (['merchant' => 23, 'zero' => 0, 'one' => 1, 'revocation' => 2, 'identity' => 1, 'emptygrants' => 1, 'errors' => 1] as $group => $count) {
            $password = bin2hex(random_bytes(24)).'!aA9';
            $owner = $this->createIdentityUser(['password' => bin2hex(random_bytes(24))]);
            $member = $this->createIdentityUser([
                'email' => 'f2-'.$group.'@example.test',
                'password' => $password,
                'name' => 'F2 '.ucfirst($group),
                'email_verified_at' => $group === 'one' ? null : now(),
            ]);
            $stores = [];
            for ($index = 0; $index < $count; $index++) {
                $name = $group.' Store '.($index + 1);
                if ($group === 'merchant' && $index === 1) $name = str_repeat('LongStore', 13).'XYZ';
                $store = $this->activeMerchantStore($owner, $name);
                $role = $this->createStoreRole($store, ['name' => $group === 'emptygrants' ? 'Administrator' : 'Merchant Reader']);
                $replacement = $this->createStoreRole($store, ['name' => 'Replacement Reader']);
                if ($group !== 'emptygrants') $this->grantMerchantPermission($store, $role, $index === 1 ? 'products.view' : 'orders.view');
                $this->grantMerchantPermission($store, $replacement, 'products.view');
                $membership = $this->createStoreMembership($store, $member, ['role_id' => $role->getKey()]);
                $stores[] = ['id' => $store->public_id, 'name' => $store->name];
                if ($index === 0) $private[$group] = [
                    'owner' => $owner->getKey(), 'member' => $member->getKey(), 'store' => $store->getKey(),
                    'membership' => $membership->getKey(), 'role' => $role->getKey(), 'replacement' => $replacement->getKey(),
                ];
            }
            // Draft ownership intentionally does not imply an eligible operational Store.
            if ($group === 'zero') $this->createStore($member, ['name' => 'Draft owned Store']);
            $public[$group] = ['email' => $member->email, 'password' => $password, 'principalId' => $member->getKey(), 'stores' => $stores];
        }
        $foreign = $this->activeMerchantStore($owner, 'Foreign Store Canary F2');
        $public['foreign'] = ['id' => $foreign->public_id, 'name' => $foreign->name];
        file_put_contents('/tmp/f2-private.json', json_encode($private, JSON_THROW_ON_ERROR));
        chmod('/tmp/f2-private.json', 0600);
        file_put_contents('/tmp/f2-browser.json', json_encode($public, JSON_THROW_ON_ERROR));
        chmod('/tmp/f2-browser.json', 0600);
        return ['seeded' => true, 'merchant_store_count' => 23, 'fixture_groups' => count($public) - 1];
    }

    public function change(string $group, string $change): array
    {
        $private = json_decode(file_get_contents('/tmp/f2-private.json'), true, flags: JSON_THROW_ON_ERROR);
        $ids = $private[$group] ?? throw new RuntimeException('Unknown fixture group.');
        $fixture = [
            'owner' => User::query()->findOrFail($ids['owner']),
            'member' => User::query()->findOrFail($ids['member']),
            'store' => Store::query()->findOrFail($ids['store']),
            'membership' => StoreMembership::withoutGlobalScopes()->findOrFail($ids['membership']),
            'role' => Role::withoutGlobalScopes()->findOrFail($ids['role']),
            'replacement' => Role::withoutGlobalScopes()->findOrFail($ids['replacement']),
        ];
        $this->changeMerchantAuthority($change, $fixture);
        return ['changed' => $change, 'group' => $group];
    }
}

$fixtures = new FrontendIntegrationFixtures;
$result = ($argv[1] ?? '') === 'seed' ? DB::transaction(fn () => $fixtures->seed()) : $fixtures->change($argv[1] ?? '', $argv[2] ?? '');
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
