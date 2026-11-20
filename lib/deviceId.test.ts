import { describe, expect, test } from 'vitest';
import { getDeviceId } from './deviceId';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const VALID = /^[A-Za-z0-9_-]{8,64}$/;

describe('getDeviceId', () => {
  test('creates a valid id once and then keeps returning it', () => {
    const storage = memoryStorage();
    const id = getDeviceId(storage);
    expect(id).toMatch(VALID);
    expect(getDeviceId(storage)).toBe(id);
    expect(storage.data.get('bid11pro.deviceId')).toBe(id);
  });

  test('reuses a stored id and replaces a tampered one', () => {
    expect(getDeviceId(memoryStorage({ 'bid11pro.deviceId': 'stored-id-123456' }))).toBe('stored-id-123456');
    const tampered = memoryStorage({ 'bid11pro.deviceId': 'bad id!' });
    expect(getDeviceId(tampered)).toMatch(VALID);
    expect(tampered.data.get('bid11pro.deviceId')).not.toBe('bad id!');
  });

  test('blocked storage still gives a stable id for the page', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const id = getDeviceId(blocked);
    expect(id).toMatch(VALID);
    expect(getDeviceId(blocked)).toBe(id);
  });
});
