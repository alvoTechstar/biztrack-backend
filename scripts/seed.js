// Idempotent seed script for the default BizTrack platform business and its
// Super Admin accounts. Safe to re-run: it checks for existing records by
// registration number / email before creating anything.
//
// Run with: npm run seed
require('dotenv').config();

const { storage } = require('../src/utils/storage.js');
const businessController = require('../src/controllers/businessController.js');
const userController = require('../src/controllers/userController.js');

const DEFAULT_BUSINESS = {
    businessName: 'BizTrack',
    registrationNumber: 'BIZTRACK-HQ-0001',
    address: 'BizTrack HQ, Nairobi, Kenya',
    businessType: 'Other',
    email: 'admin@example.com',
    phone: '+254700000000',
    owner: 'BizTrack Platform',
    paymentType: 'TILL',
    tillNumber: '000000',
};

const DEFAULT_ADMINS = [
    {
        firstName: 'Super',
        lastName: 'AdminOne',
        email: 'biztrack@sharklasers.com',
        username: 'superadmin1',
        phoneNumber: '+254700000001',
    },
    {
        firstName: 'Super',
        lastName: 'AdminTwo',
        email: 'superadmin2c@example.com',
        username: 'superadmin2c',
        phoneNumber: '+254700000002',
    },
];

function makeRes(label) {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

async function ensureBusiness() {
    const existing = await storage.getBusinessByRegistrationNumber(DEFAULT_BUSINESS.registrationNumber);
    if (existing) {
        console.log(`⏭  Business "${DEFAULT_BUSINESS.businessName}" already exists (id: ${existing.id}), skipping.`);
        return existing.id;
    }

    const res = makeRes('CREATE BUSINESS');
    await businessController.createBusiness({ body: DEFAULT_BUSINESS, file: undefined }, res);

    if (res.statusCode >= 400) {
        throw new Error(`Failed to create default business: ${JSON.stringify(res.body)}`);
    }

    const business = res.body.business;
    console.log(`✅ Created business "${business.businessName}" (id: ${business.id})`);
    return business.id;
}

async function ensureAdmin(admin, businessId) {
    const existing = await storage.getUserByEmail(admin.email);
    if (existing) {
        console.log(`⏭  User "${admin.email}" already exists, skipping.`);
        return;
    }

    const res = makeRes(`CREATE USER ${admin.username}`);
    await userController.createUser(
        {
            body: { ...admin, role: 'Super_Admin', businessId },
            user: { id: 'seed-script', role: 'Super_Admin' },
        },
        res
    );

    if (res.statusCode >= 400) {
        console.error(`❌ Failed to create "${admin.email}": ${JSON.stringify(res.body)}`);
        return;
    }

    console.log(`✅ Created Super_Admin "${admin.email}"`);
}

async function main() {
    const businessId = await ensureBusiness();

    for (const admin of DEFAULT_ADMINS) {
        await ensureAdmin(admin, businessId);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Seed script failed:', err);
    process.exit(1);
});
