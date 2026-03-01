/**
 * Clear all mock job data from the database.
 * Keeps: Organization, UserProfile (employees), OrganizationSetting, KPI tables
 * Deletes: Jobs (+ cascade: estimates, invoices, tasks, expenses, time entries, files, etc.),
 *          Customers, Leads, ActivityLogs, AuditLogs, ShareLinks, PortalLinks, PortalMessages
 *
 * Run: npx tsx scripts/clear-mock-data.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("🧹 Clearing mock data...\n");

    // Count before
    const jobCount = await prisma.job.count();
    const customerCount = await prisma.customer.count();
    const leadCount = await prisma.lead.count();
    const userCount = await prisma.userProfile.count();

    console.log(`  Found: ${jobCount} jobs, ${customerCount} customers, ${leadCount} leads`);
    console.log(`  Keeping: ${userCount} employees\n`);

    // Delete in dependency order. Cascade handles most relations,
    // but we delete explicitly for clarity.

    // 1. Activity logs (references jobs)
    const activityDeleted = await prisma.activityLog.deleteMany({});
    console.log(`  ✓ Deleted ${activityDeleted.count} activity logs`);

    // 2. Audit logs
    const auditDeleted = await prisma.auditLog.deleteMany({});
    console.log(`  ✓ Deleted ${auditDeleted.count} audit logs`);

    // 3. Portal messages
    const portalMsgDeleted = await prisma.portalMessage.deleteMany({});
    console.log(`  ✓ Deleted ${portalMsgDeleted.count} portal messages`);

    // 4. Portal links
    const portalLinkDeleted = await prisma.portalLink.deleteMany({});
    console.log(`  ✓ Deleted ${portalLinkDeleted.count} portal links`);

    // 5. Share links
    const shareLinkDeleted = await prisma.shareLink.deleteMany({});
    console.log(`  ✓ Deleted ${shareLinkDeleted.count} share links`);

    // 6. Jobs (cascade: estimates, change orders, invoices, payments,
    //    line items, tasks, expenses, file assets, time entries,
    //    job assignments, schedule events)
    const jobsDeleted = await prisma.job.deleteMany({});
    console.log(`  ✓ Deleted ${jobsDeleted.count} jobs (+ all related data)`);

    // 7. Leads
    const leadsDeleted = await prisma.lead.deleteMany({});
    console.log(`  ✓ Deleted ${leadsDeleted.count} leads`);

    // 8. Customers
    const customersDeleted = await prisma.customer.deleteMany({});
    console.log(`  ✓ Deleted ${customersDeleted.count} customers`);

    // Verify employees survived
    const remainingUsers = await prisma.userProfile.findMany({
        select: { fullName: true, role: true, isActive: true },
        orderBy: { fullName: "asc" },
    });

    console.log(`\n✅ Done! ${remainingUsers.length} employees preserved:\n`);
    for (const u of remainingUsers) {
        console.log(`  ${u.isActive ? "🟢" : "⚪"} ${u.fullName} (${u.role})`);
    }

    console.log("\n🎉 Ready for live work!");
}

main()
    .catch((e) => {
        console.error("❌ Error:", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
