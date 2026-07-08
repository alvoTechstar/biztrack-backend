import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // Default system business
  let business = await prisma.business.findUnique({ where: { businessId: 0 } });
  if (!business) {
    business = await prisma.business.create({
      data: {
        businessId: 0,
        registrationNumber: "BIZTRACK-SYSTEM-0001",
        businessName: "BizTrack System",
        owner: "BizTrack Admin",
        businessType: "System",
        email: "admin@biztrack.com",
        phone: "0700000000",
        status: "active",
      },
    });
    console.log("Created default business:", business.businessName);
  } else {
    console.log("Default business already exists.");
  }

  // Default admin user
  const existing = await prisma.user.findUnique({ where: { email: "admin@biztrack.com" } });
  if (!existing) {
    const hashed = await bcrypt.hash("!Biztrack1", 10);
    await prisma.user.create({
      data: {
        username: "admin",
        email: "admin@biztrack.com",
        password: hashed,
        firstName: "BizTrack",
        lastName: "Admin",
        phone: "0700000000",
        role: "Biztrack_ADMIN",
        status: "ACTIVE",
        associatedBusinessId: business.id,
        permissions: ["read", "write", "delete"],
      },
    });
    console.log("Created default admin user: admin@biztrack.com");
  } else {
    console.log("Default admin user already exists.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
