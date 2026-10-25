import { ProfileField } from './ProfileField.tsx';
import type { KindForm } from '@repo/vpn-sdk/ui';
import { type OpenVpn, OPENVPN_FILE } from './kind.ts';

/** OpenVPN: servers and certificates come from the provider's .ovpn profile. */
export const openvpnForm: KindForm<OpenVpn> = {
  label: 'OpenVPN',
  hint: 'Needs the .ovpn file from your provider',
  Main: ({ vpn, onChange, errors, pending, storedSlots, setSecret }) => (
    <ProfileField
      remotes={vpn.remotes}
      hasProfile={storedSlots.includes('profile') || typeof pending.profile === 'string'}
      error={errors['secrets.profile']}
      onImport={(text) => {
        const read = OPENVPN_FILE.read(text, vpn);
        if (!read.ok) return read.error;
        onChange(read.vpn);
        // The profile is the file's only secret: kept whole.
        setSecret('profile', text);
        return undefined;
      }}
    />
  ),
  username: (vpn) => ({
    hint: vpn.needsPassword ? 'Your profile signs in with a username and password.' : 'Leave empty if the profile only uses certificates.',
  }),
  extraOptions: { hint: 'Extra OpenVPN directives, one per line.', placeholder: 'tun-mtu 1400' },
};
