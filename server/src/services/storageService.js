const STORAGE_KEYS = [
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
];

export function getStorageStatus(environment) {
  const configured = STORAGE_KEYS.every((key) => Boolean(environment[key]));
  return configured ? 'configured_unverified' : 'not_configured';
}
