// src/pgStorage.js — PostgreSQL drop-in replacement for mongoStorage.js
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import prisma from "./db.pg.js";
import { logger } from "./logger.js";

// ─── Shape helpers ────────────────────────────────────────────────────────────

// Restores the nested paymentConfig shape that controllers expect.
function formatBusiness(b) {
  if (!b) return undefined;
  const { paymentType, tillNumber, paybillNumber, accountNumber, pochiNumber, ...rest } = b;
  return {
    ...rest,
    paymentConfig: { paymentType, tillNumber, paybillNumber, accountNumber, pochiNumber },
  };
}

// Flattens paymentConfig from incoming business data into DB columns.
function flattenBusiness(data) {
  const { paymentConfig, logoFile, ...rest } = data;
  return paymentConfig ? { ...rest, ...paymentConfig } : rest;
}

// Derives product status from stock / threshold — mirrors the Mongoose pre-save hook.
function deriveProductStatus(stock, threshold) {
  if (stock === 0) return "Out of Stock";
  if (stock < threshold) return "Low Stock";
  return "In Stock";
}

// ─── PgStorage ────────────────────────────────────────────────────────────────

export class PgStorage {
  async initialize() {
    await this.createDefaultSetup();
    await this.cleanupExpiredOTPs();
    logger.ok("PgStorage initialized", "DB");
  }

  async createDefaultSetup() {
    try {
      logger.info("Checking for default business and admin...", "DB");

      let business = await prisma.business.findFirst({
        where: { businessName: "BizTrack Application" },
      });

      if (!business) {
        business = await prisma.business.create({
          data: {
            id: randomUUID(),
            businessId: 0,
            registrationNumber: "BRN-SYSTEM-001",
            businessName: "BizTrack Application",
            owner: "admin@biztrack.com",
            businessType: "System",
            email: "system@biztrack.com",
            phone: "0711000000",
            address: "Nairobi, Kenya",
            website: "https://biztrack.com",
            description: "Default BizTrack System Business",
            logoUrl: "https://stage.biztrack.co.za/",
            primaryColor: "#4F46E5",
            status: "active",
          },
        });
        logger.ok("Default business created", "DB");
      } else {
        logger.info("Default business already exists", "DB");
      }

      const existingAdmin = await prisma.user.findFirst({
        where: { email: "admin@biztrack.com" },
      });

      if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash("Admin123!", 10);
        await prisma.user.create({
          data: {
            id: randomUUID(),
            username: "admin@biztrack.com",
            email: "admin@biztrack.com",
            password: hashedPassword,
            firstName: "Super",
            lastName: "Admin",
            phone: "0711000001",
            role: "Super_Admin",
            businessName: "BizTrack Application",
            associatedBusinessId: business.id,
            institutionId: business.id,
            institutionName: "BizTrack Application",
            status: "ACTIVE",
            permissions: ["read", "write", "delete", "admin", "super_admin"],
            lastLogin: "Never",
          },
        });
        logger.ok("Default super admin created", "DB");
      }

      logger.ok("Default credentials → email: admin@biztrack.com | password: Admin123!", "DB");
    } catch (error) {
      logger.error(`Default setup failed: ${error.message}`, "DB");
    }
  }

  // ─── OTP helpers ──────────────────────────────────────────────────────────

  maskOTP(otp) {
    if (!otp || otp.length !== 6) return "******";
    return `${otp.charAt(0)}****${otp.charAt(5)}`;
  }

  fullyMaskOTP() {
    return "••••••";
  }

  // ─── OTP methods ──────────────────────────────────────────────────────────

  async createOTP(email, otp, type, userId = null, metadata = {}) {
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const { count } = await prisma.otp.updateMany({
        where: { email, type, status: "pending" },
        data: { status: "revoked", updatedAt: new Date() },
      });

      if (count > 0) {
        logger.info(`Revoked ${count} previous pending OTP(s) for ${email}`, "OTP");
      }

      const saved = await prisma.otp.create({
        data: {
          id: randomUUID(),
          email,
          originalOtp: otp,
          maskedOtp: this.maskOTP(otp),
          type,
          userId,
          expiresAt,
          status: "pending",
          ipAddress: metadata.ipAddress ?? null,
          userAgent: metadata.userAgent ?? null,
        },
      });

      logger.ok(
        `Created | ${email} | code: ${saved.originalOtp} | masked: ${saved.maskedOtp} | status: pending | expires: ${saved.expiresAt.toISOString()}`,
        "OTP"
      );

      return { id: saved.id, otp: saved.originalOtp, maskedOtp: saved.maskedOtp };
    } catch (error) {
      logger.error(`Create failed for ${email}: ${error.message}`, "OTP");
      throw error;
    }
  }

  async getValidOTP(email, otp, type = null, metadata = {}) {
    try {
      const now = new Date();
      const found = await prisma.otp.findFirst({
        where: {
          email: email.trim().toLowerCase(),
          originalOtp: otp,
          expiresAt: { gt: now },
          status: "pending",
          ...(type ? { type } : {}),
        },
        orderBy: { createdAt: "desc" },
      });

      if (!found) {
        logger.warn(`No valid pending OTP for ${email}`, "OTP");
        return null;
      }

      const updated = await prisma.otp.update({
        where: { id: found.id },
        data: {
          attempts: { increment: 1 },
          ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          updatedAt: new Date(),
        },
      });

      logger.ok(`Validated | ${email} | attempt: ${updated.attempts} | status: pending`, "OTP");
      return updated;
    } catch (error) {
      logger.error(`Validate failed for ${email}: ${error.message}`, "OTP");
      return null;
    }
  }

  async consumeOTP(email, otp = null, _metadata = {}) {
    try {
      const { count } = await prisma.otp.updateMany({
        where: {
          email: email.trim().toLowerCase(),
          status: "pending",
          ...(otp ? { originalOtp: otp } : {}),
        },
        data: {
          status: "consumed",
          consumedAt: new Date(),
          maskedOtp: this.fullyMaskOTP(),
          updatedAt: new Date(),
        },
      });

      if (count > 0) {
        logger.ok(`Consumed | ${email} | pending → consumed | code cleared to ••••••`, "OTP");
      } else {
        logger.warn(`Nothing to consume for ${email} (already consumed or not found)`, "OTP");
      }

      return count > 0;
    } catch (error) {
      logger.error(`Consume failed for ${email}: ${error.message}`, "OTP");
      return false;
    }
  }

  // Backward-compatibility alias
  async markOTPAsUsed(email, otp = null) {
    return this.consumeOTP(email, otp);
  }

  async getRecentOTPAttempts(email, minutes = 10) {
    try {
      const timeLimit = new Date(Date.now() - minutes * 60 * 1000);
      return await prisma.otp.count({
        where: {
          email: email.trim().toLowerCase(),
          createdAt: { gt: timeLimit },
          status: "pending",
        },
      });
    } catch (error) {
      logger.error(`getRecentOTPAttempts failed: ${error.message}`, "OTP");
      return 0;
    }
  }

  async getOTPStatus(email, otp = null) {
    try {
      const record = await prisma.otp.findFirst({
        where: {
          email: email.trim().toLowerCase(),
          ...(otp ? { originalOtp: otp } : {}),
        },
        orderBy: { createdAt: "desc" },
      });

      if (!record) {
        return { exists: false, status: "not_found", message: "No OTP found for this email" };
      }

      const now = new Date();
      const isExpired = record.expiresAt < now;
      const actualStatus =
        record.status === "pending" && isExpired ? "expired" : record.status;
      const isFinalized = actualStatus === "consumed" || actualStatus === "revoked";

      return {
        exists: true,
        id: record.id,
        email: record.email,
        originalOtp: isFinalized ? this.fullyMaskOTP() : this.maskOTP(record.originalOtp),
        maskedOtp: record.maskedOtp,
        type: record.type,
        status: actualStatus,
        isExpired,
        attempts: record.attempts,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
        canBeUsed: actualStatus === "pending" && !isExpired,
      };
    } catch (error) {
      logger.error(`getOTPStatus failed: ${error.message}`, "OTP");
      return { exists: false, status: "error", message: error.message };
    }
  }

  async cleanupExpiredOTPs() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.otp.deleteMany({
        where: { createdAt: { lt: thirtyDaysAgo } },
      });
      if (count > 0) logger.info(`Cleaned up ${count} OTP(s) older than 30 days`, "OTP");
      return count;
    } catch (error) {
      logger.error(`Cleanup failed: ${error.message}`, "OTP");
      return 0;
    }
  }

  async debugOTPs(email = null) {
    try {
      const where = email ? { email: email.trim().toLowerCase() } : {};
      const [records, total, byStatus] = await Promise.all([
        prisma.otp.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 }),
        prisma.otp.count({ where }),
        prisma.otp.groupBy({ by: ["status"], where, _count: { _all: true } }),
      ]);

      logger.info(`Total: ${total} | Showing: ${records.length}`, "OTP");
      records.forEach((o) => {
        const display = o.maskedOtp || this.maskOTP(o.originalOtp);
        logger.debug(`${o.status.padEnd(8)} | ${o.email} | ${display} | type: ${o.type} | attempts: ${o.attempts}`, "OTP");
      });
      logger.info(byStatus.map((s) => `${s.status}: ${s._count._all}`).join(" | "), "OTP");
    } catch (error) {
      logger.error(`debugOTPs failed: ${error.message}`, "OTP");
    }
  }

  // ─── User methods ─────────────────────────────────────────────────────────

  async getUserByEmail(email) {
    try {
      return (await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() } })) ?? undefined;
    } catch (error) {
      logger.error(`getUserByEmail failed: ${error.message}`, "USER");
      throw error;
    }
  }

  async getUser(id) {
    try {
      return (await prisma.user.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      logger.error(`getUser failed: ${error.message}`, "USER");
      return undefined;
    }
  }

  async getUserByUsername(username) {
    try {
      return (await prisma.user.findUnique({ where: { username } })) ?? undefined;
    } catch (error) {
      logger.error(`getUserByUsername failed: ${error.message}`, "USER");
      throw error;
    }
  }

  async createUser(userData) {
    try {
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Only pass fields that exist on the User table.
      // Routes may include extra keys like businessId (numeric), businessUUID,
      // createdBy, createdAt — strip them here to avoid Prisma unknown-argument errors.
      const {
        username, email, firstName, lastName,
        phone, phoneNumber,           // accept either spelling
        role, businessName,
        associatedBusinessId, institutionId, institutionName,
        status, permissions, lastLogin,
      } = userData;

      const user = await prisma.user.create({
        data: {
          id: randomUUID(),
          username,
          email,
          firstName,
          lastName,
          phone: phone ?? phoneNumber,  // normalise phoneNumber → phone
          ...(role              && { role }),
          ...(businessName      && { businessName }),
          ...(associatedBusinessId && { associatedBusinessId: String(associatedBusinessId) }),
          ...(institutionId     && { institutionId: String(institutionId) }),
          ...(institutionName   && { institutionName }),
          ...(status            && { status }),
          ...(permissions       && { permissions }),
          ...(lastLogin         && { lastLogin }),
          password: hashedPassword,
        },
      });

      logger.ok(`Created user ${user.email} | role: ${user.role}`, "USER");
      return user;
    } catch (error) {
      logger.error(`createUser failed: ${error.message}`, "USER");
      throw error;
    }
  }

  async updateUserPassword(userId, newPassword) {
    try {
      return await prisma.user.update({
        where: { id: userId },
        data: { password: newPassword, updatedAt: new Date() },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      logger.error(`updateUserPassword failed: ${error.message}`, "USER");
      throw error;
    }
  }

  async updateUser(id, updateData) {
    try {
      // Strip password and any non-schema keys before updating.
      const {
        password, businessId, businessUUID, createdBy, createdAt,
        phoneNumber,
        phone,
        ...rest
      } = updateData;

      const data = {
        ...rest,
        ...(phone || phoneNumber ? { phone: phone ?? phoneNumber } : {}),
        updatedAt: new Date(),
      };

      return await prisma.user.update({ where: { id }, data });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      logger.error(`updateUser failed: ${error.message}`, "USER");
      throw error;
    }
  }

  async deleteUser(id) {
    try {
      await prisma.user.delete({ where: { id } });
      return true;
    } catch (error) {
      if (error.code === "P2025") return false;
      throw error;
    }
  }

  async getAllUsers() {
    try {
      return await prisma.user.findMany();
    } catch (error) {
      logger.error(`getAllUsers failed: ${error.message}`, "USER");
      throw error;
    }
  }

  async updateUserLastLogin(userId) {
    try {
      return await prisma.user.update({
        where: { id: userId },
        data: { lastLogin: new Date().toISOString(), updatedAt: new Date() },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      logger.error(`updateUserLastLogin failed: ${error.message}`, "USER");
      throw error;
    }
  }

  // ─── Business methods ─────────────────────────────────────────────────────

  async getBusiness(identifier) {
    try {
      let b = await prisma.business.findUnique({ where: { id: identifier } });
      if (b) return formatBusiness(b);

      const numId = parseInt(identifier, 10);
      if (!isNaN(numId)) {
        b = await prisma.business.findUnique({ where: { businessId: numId } });
        if (b) return formatBusiness(b);
      }

      logger.warn(`Business not found: ${identifier}`, "BUSINESS");
      return undefined;
    } catch (error) {
      logger.error(`getBusiness failed: ${error.message}`, "BUSINESS");
      return undefined;
    }
  }

  async generateBusinessId() {
    try {
      const highest = await prisma.business.findFirst({
        where: { businessId: { not: 0 } },
        orderBy: { businessId: "desc" },
        select: { businessId: true },
      });
      return highest ? highest.businessId + 1 : 1;
    } catch (error) {
      logger.warn(`generateBusinessId fallback used: ${error.message}`, "BUSINESS");
      const count = await prisma.business.count({ where: { businessId: { not: 0 } } });
      return count + 1;
    }
  }

  async createBusiness(businessData) {
    const businessId = await this.generateBusinessId();
    const flat = flattenBusiness(businessData);
    const b = await prisma.business.create({
      data: { ...flat, id: randomUUID(), businessId },
    });
    return formatBusiness(b);
  }

  async getBusinessByRegistrationNumber(regNumber) {
    const b = await prisma.business.findUnique({
      where: { registrationNumber: regNumber },
    });
    return formatBusiness(b);
  }

  async getBusinessByName(name) {
    const b = await prisma.business.findUnique({ where: { businessName: name } });
    return formatBusiness(b);
  }

  async getBusinesses() {
    const list = await prisma.business.findMany({ orderBy: { businessId: "asc" } });
    return list.map(formatBusiness);
  }

  async updateBusiness(id, updateData) {
    try {
      const { registrationNumber, owner, ...rest } = updateData;
      const flat = flattenBusiness(rest);
      const b = await prisma.business.update({
        where: { id },
        data: { ...flat, updatedAt: new Date() },
      });
      logger.ok(`Updated business ${b.businessName}`, "BUSINESS");
      return formatBusiness(b);
    } catch (error) {
      if (error.code === "P2025") return undefined;
      logger.error(`updateBusiness failed: ${error.message}`, "BUSINESS");
      throw error;
    }
  }

  async deleteBusiness(id) {
    try {
      await prisma.business.delete({ where: { id } });
      return true;
    } catch (error) {
      if (error.code === "P2025") return false;
      throw error;
    }
  }

  async getBusinessUsers(businessId) {
    return await prisma.user.findMany({
      where: { associatedBusinessId: businessId.toString() },
    });
  }

  async getBusinessByBusinessId(businessId) {
    try {
      const numId = Number(businessId);
      if (isNaN(numId)) return undefined;
      const b = await prisma.business.findUnique({ where: { businessId: numId } });
      return formatBusiness(b);
    } catch (error) {
      logger.error(`getBusinessByBusinessId failed: ${error.message}`, "BUSINESS");
      return undefined;
    }
  }

  async getBusinessByIdentifier(identifier) {
    const numId = parseInt(identifier, 10);
    if (!isNaN(numId)) {
      const b = await prisma.business.findUnique({ where: { businessId: numId } });
      if (b) return formatBusiness(b);
    }

    const byUUID = await prisma.business.findUnique({ where: { id: identifier } });
    if (byUUID) return formatBusiness(byUUID);

    const byReg = await prisma.business.findUnique({
      where: { registrationNumber: identifier },
    });
    if (byReg) return formatBusiness(byReg);

    const byName = await prisma.business.findUnique({ where: { businessName: identifier } });
    return formatBusiness(byName);
  }

  // ─── Product helpers (used by ProductController directly) ────────────────
  // These mirror the Mongoose model methods so ProductController can migrate
  // without changing its interface.

  async getProducts(businessId) {
    return await prisma.product.findMany({
      where: { businessId: Number(businessId) },
      orderBy: { createdAt: "desc" },
    });
  }

  async getProduct(id) {
    return (await prisma.product.findUnique({ where: { id } })) ?? undefined;
  }

  async getProductBySku(sku, businessId) {
    return (
      (await prisma.product.findUnique({
        where: { sku_businessId: { sku: sku.toUpperCase(), businessId: Number(businessId) } },
      })) ?? undefined
    );
  }

  async createProduct(data) {
    const stock = data.stock ?? 0;
    const threshold = data.threshold ?? 10;
    return await prisma.product.create({
      data: {
        ...data,
        id: randomUUID(),
        sku: data.sku.toUpperCase(),
        businessId: Number(data.businessId),
        status: deriveProductStatus(stock, threshold),
      },
    });
  }

  async updateProduct(id, data) {
    try {
      const current = await prisma.product.findUnique({
        where: { id },
        select: { stock: true, threshold: true },
      });
      if (!current) return undefined;

      const stock = data.stock ?? current.stock;
      const threshold = data.threshold ?? current.threshold;

      return await prisma.product.update({
        where: { id },
        data: { ...data, status: deriveProductStatus(stock, threshold), updatedAt: new Date() },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      throw error;
    }
  }

  async deleteProduct(id) {
    try {
      return await prisma.product.delete({ where: { id } });
    } catch (error) {
      if (error.code === "P2025") return null;
      throw error;
    }
  }

  // ─── Menu item helpers (hotel menu — separate from kiosk products) ───────

  async getMenuItems(businessId) {
    return await prisma.menuItem.findMany({
      where: { businessId: Number(businessId) },
      orderBy: { createdAt: "desc" },
    });
  }

  async getMenuItem(id) {
    return (await prisma.menuItem.findUnique({ where: { id } })) ?? undefined;
  }

  async createMenuItem(data) {
    return await prisma.menuItem.create({
      data: {
        ...data,
        id: randomUUID(),
        businessId: Number(data.businessId),
      },
    });
  }

  async updateMenuItem(id, data) {
    try {
      return await prisma.menuItem.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      throw error;
    }
  }

  async deleteMenuItem(id) {
    try {
      return await prisma.menuItem.delete({ where: { id } });
    } catch (error) {
      if (error.code === "P2025") return null;
      throw error;
    }
  }

  // ─── Transaction helpers ─────────────────────────────────────────────────

  async getTransactions(businessId, filters = {}) {
    const where = { businessId: String(businessId), ...filters };
    return await prisma.transaction.findMany({
      where,
      include: { items: true },
      orderBy: { timestamp: "desc" },
    });
  }

  async getTransaction(id) {
    return (
      (await prisma.transaction.findUnique({
        where: { transactionId: id },
        include: { items: true },
      })) ?? undefined
    );
  }

  async getTransactionByCheckoutId(checkoutRequestId) {
    return (
      (await prisma.transaction.findFirst({
        where: { checkoutRequestId },
        include: { items: true },
      })) ?? undefined
    );
  }

  async createTransaction(data) {
    const { items = [], businessId, ...rest } = data;
    return await prisma.transaction.create({
      data: {
        ...rest,
        businessId: String(businessId),
        id: randomUUID(),
        items: {
          create: items.map((item) => ({ ...item, id: randomUUID() })),
        },
      },
      include: { items: true },
    });
  }

  async getDebtsByBusiness(businessId, includeResolved = false) {
    try {
      const where = {
        businessId: String(businessId),
        paymentMethod: 'debt',
      };
      if (!includeResolved) where.debtPaid = false;
      return await prisma.transaction.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      logger.error(`getDebtsByBusiness failed: ${error.message}`, 'TRANSACTION');
      throw error;
    }
  }

  async updateTransaction(transactionId, data) {
    try {
      const { items, ...rest } = data;
      return await prisma.transaction.update({
        where: { transactionId },
        data: { ...rest, updatedAt: new Date() },
        include: { items: true },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      throw error;
    }
  }

  // Look up a transaction by its Prisma UUID primary key (used when the route
  // parameter is the internal id, not the business transactionId string).
  async getTransactionByUUID(id) {
    return (
      (await prisma.transaction.findUnique({
        where: { id },
        include: { items: true },
      })) ?? undefined
    );
  }

  // Update by Prisma UUID primary key.
  async updateTransactionByUUID(id, data) {
    try {
      const { items, ...rest } = data;
      return await prisma.transaction.update({
        where: { id },
        data: { ...rest, updatedAt: new Date() },
        include: { items: true },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      throw error;
    }
  }

  // Shallow-merge `patch` into the existing paymentDetails JSON column.
  async patchTransactionPaymentDetails(id, patch) {
    try {
      const row = await prisma.transaction.findUnique({
        where: { id },
        select: { paymentDetails: true },
      });
      if (!row) return undefined;
      const merged = { ...(row.paymentDetails ?? {}), ...patch };
      return await prisma.transaction.update({
        where: { id },
        data: { paymentDetails: merged, updatedAt: new Date() },
      });
    } catch (error) {
      if (error.code === "P2025") return undefined;
      throw error;
    }
  }

  // Flexible filtered query used by report / list endpoints.
  async queryTransactions(where, { skip = 0, take = 100 } = {}) {
    return await prisma.transaction.findMany({
      where,
      include: { items: true },
      orderBy: { timestamp: "desc" },
      skip,
      take,
    });
  }

  async countTransactions(where) {
    return await prisma.transaction.count({ where });
  }

  // ─── Order methods ───────────────────────────────────────────────────────────

  async createOrder(data) {
    const { items = [], ...rest } = data;
    return await prisma.order.create({
      data: {
        ...rest,
        id: randomUUID(),
        items: { create: items.map(item => ({ ...item, id: randomUUID() })) },
      },
      include: { items: true },
    });
  }

  async getOrder(id) {
    return (
      (await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      })) ?? undefined
    );
  }

  async getOrderByOrderId(orderId) {
    return (
      (await prisma.order.findUnique({
        where: { orderId },
        include: { items: true },
      })) ?? undefined
    );
  }

  async getOrdersByBusiness(businessId, { statuses, from, to, waiter } = {}) {
    const where = { businessId: String(businessId) };
    if (statuses && statuses.length > 0) where.status = { in: statuses };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (waiter) where.waiter = { contains: waiter, mode: 'insensitive' };
    return await prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateOrder(id, data) {
    try {
      return await prisma.order.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
        include: { items: true },
      });
    } catch (error) {
      if (error.code === 'P2025') return undefined;
      throw error;
    }
  }

  // Atomically create a payment Transaction and mark the linked Order as completed.
  async createPaymentTransaction(txData, orderId) {
    return await prisma.$transaction(async (tx) => {
      const { items = [], businessId, ...rest } = txData;
      const transaction = await tx.transaction.create({
        data: {
          ...rest,
          businessId: String(businessId),
          id: randomUUID(),
          items: { create: items.map(item => ({ ...item, id: randomUUID() })) },
        },
        include: { items: true },
      });

      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'completed',
          transactionId: transaction.id,
          completedAt: new Date(),
        },
        include: { items: true },
      });

      return { transaction, order };
    });
  }
}
