export async function migrateCustomersToClients(storeId: number): Promise<{ migrated: number; skipped: number }> {
  return { migrated: 0, skipped: 0 };
}
