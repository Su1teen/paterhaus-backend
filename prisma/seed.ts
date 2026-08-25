import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const META_CONNECTOR_PROVIDER = 'paterhaus_meta_connector';

const users = [
  { email: 'admin@paterhaus.com', name: 'Paterhaus Admin', role: UserRole.ADMIN },
  { email: 'marketing@paterhaus.com', name: 'Paterhaus Marketing', role: UserRole.MARKETING },
];

const mappings = [
  { sourceValue: 'Property Management', targetValue: 'PROPERTY_MANAGEMENT' },
  { sourceValue: 'Snagging', targetValue: 'SNAGGING' },
  { sourceValue: 'Staging', targetValue: 'STAGING' },
];

async function main(): Promise<void> {
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role },
      create: user,
    });
  }

  for (const mapping of mappings) {
    await prisma.integrationMapping.upsert({
      where: {
        provider_sourceField_sourceValue_targetField: {
          provider: META_CONNECTOR_PROVIDER,
          sourceField: 'service',
          sourceValue: mapping.sourceValue,
          targetField: 'direction',
        },
      },
      update: { targetValue: mapping.targetValue, active: true },
      create: {
        provider: META_CONNECTOR_PROVIDER,
        sourceField: 'service',
        sourceValue: mapping.sourceValue,
        targetField: 'direction',
        targetValue: mapping.targetValue,
        active: true,
      },
    });
  }

  console.log(`Seeded ${users.length} users and ${mappings.length} service→direction mappings.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : 'unknown error');
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
