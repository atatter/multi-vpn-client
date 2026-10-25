import { AddressFields } from './AddressFields.tsx';
import { useAddress } from './use-address.ts';

/** The first-launch version, inside the welcome: Continue sits right under the address. */
export function AddForm() {
  return <AddressFields state={useAddress()} autoFocus={false} withContinue />;
}
