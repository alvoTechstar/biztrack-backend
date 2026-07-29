const PrismaClient = require('@prisma/client').PrismaClient;
const prisma = new PrismaClient();

export const getScopedQuery  = (businessId) => {
    return {
        //this is where the core logic that filters every query.
        where: { businessId: businessId }
    };
};

export default prisma;