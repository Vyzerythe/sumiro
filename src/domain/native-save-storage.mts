import { saveKey } from './save.mts';

export const nativeSaveKey = 'sumiro.native.save.v1';

/** Native runs use their own writable key and can import either shipped save format. */
export function createNativeSaveStorage(access: () => Pick<Storage, 'getItem' | 'setItem'>) {
  return {
    getItem(key: string) {
      const storage = access();
      return key === saveKey ? storage.getItem(nativeSaveKey) ?? storage.getItem(saveKey) : storage.getItem(key);
    },
    setItem(key: string, value: string) {
      if (key !== saveKey) throw Error(`Unsupported native save key ${key}`);
      access().setItem(nativeSaveKey, value);
    },
  };
}
