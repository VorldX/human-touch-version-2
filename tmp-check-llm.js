const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const orgId = 'cmmeeuv1r0002qdbkoi1mxij8';
  const rows = await prisma.memoryEntry.findMany({
    where: { orgId, key: 'org.settings.llm', redactedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: 3,
    select: { id: true, key: true, value: true, updatedAt: true }
  });
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})();
