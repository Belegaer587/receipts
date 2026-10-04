// App lock via a platform passkey (Face ID / Touch ID / device passcode).
// This is a local gate: there is no server, so the check happens on the device only.
const KEY = 'lock-cred';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export const supported = () => !!(window.PublicKeyCredential && navigator.credentials);
export const isSetUp = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
export const reset = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export async function setup() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Receipts' },
      user: { id: rand(16), name: 'owner', displayName: 'Owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    },
  });
  localStorage.setItem(KEY, b64(cred.rawId));
}

export async function unlock() {
  await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: unb64(localStorage.getItem(KEY)), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
}
