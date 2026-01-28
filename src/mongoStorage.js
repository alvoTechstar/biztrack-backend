// src/storage/mongoStorage.js
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

// Define Mongoose schemas
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: { type: String, required: true },
  role: {
    type: String,
    enum: [
      "Super_Admin", "Biztrack_ADMIN",
      "Hotel_Admin", "Hotel_Cashier", "Hotel_Waiter",
      "Kiosk_Admin", "Kiosk_Shopkeeper",
      "Hospital_Admin", "Doctor", "Nurse", "Lab_Technician", "Receptionist", "Pharmacist",
    ],
    default: "Staff"
  },
  businessName: { type: String },
  associatedBusinessId: { type: String },
  institutionId: { type: String },
  institutionName: { type: String },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  permissions: { type: Array, default: ["read", "write", "delete"] },
  lastLogin: { type: String, default: "Never" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const businessSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  businessId: { type: Number, required: true, unique: true },
  registrationNumber: { type: String, required: true, unique: true },
  businessName: { type: String, required: true, unique: true },
  owner: { type: String, required: true },
  businessType: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, default: "" },
  website: { type: String, default: "" },
  description: { type: String, default: "" },
  logoUrl: { type: String, default: "" },
  primaryColor: { type: String, default: "#000000" },
  status: { type: String, default: "active" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// OTP Schema
const otpSchema = new mongoose.Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true, 
    default: () => randomUUID() 
  },
  email: { 
    type: String, 
    required: true, 
    index: true 
  },
  originalOtp: {
    type: String, 
    required: true 
  },
  maskedOtp: {
    type: String,
    default: null
  },
  type: { 
    type: String, 
    required: true, 
    enum: ["login", "reset", "verification"],
    default: "login" 
  },
  userId: { 
    type: String, 
    index: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: true 
  },
  status: {
    type: String,
    enum: ["pending", "consumed", "expired", "revoked"],
    default: "pending"
  },
  consumedAt: {
    type: Date 
  },
  attempts: { 
    type: Number, 
    default: 0 
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Add TTL index for auto-deletion of expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Update timestamp on save
otpSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Create Mongoose models
const User = mongoose.model('User', userSchema);
const Business = mongoose.model('Business', businessSchema);
const OTP = mongoose.model('OTP', otpSchema);

export class MongoStorage {
  constructor() {
    this.User = User;
    this.Business = Business;
    this.OTP = OTP;
  }

  async initialize() {
    await this.createDefaultSetup();
    await this.cleanupExpiredOTPs();
    console.log("MongoStorage initialized");
  }

  async createDefaultSetup() {
    try {
      const existingBusiness = await this.Business.findOne({ businessName: "BizTrack Application" });
      let business;

      if (existingBusiness) {
        business = existingBusiness;
      } else {
        const defaultBusiness = new this.Business({
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
        });

        await defaultBusiness.save();
        business = defaultBusiness;
        console.log("Default business created");
      }

      const existingAdmin = await this.User.findOne({ email: "admin@biztrack.com" });
      if (!existingAdmin) {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash("Admin123!", saltRounds);

        const defaultAdmin = new this.User({
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
        });

        await defaultAdmin.save();
        console.log("Default admin user created");
      }

    } catch (error) {
      console.error("Error creating default setup:", error.message);
      throw error;
    }
  }

  // ==================== OTP METHODS ====================

  maskOTP(otp) {
    if (!otp || otp.length !== 6) return "******";
    return `${otp.charAt(0)}****${otp.charAt(5)}`;
  }

  fullyMaskOTP(otp) {
    return "••••••";
  }

  async createOTP(email, otp, type, userId = null, metadata = {}) {
    try {
      console.log(`OTP created for ${email}: ${this.maskOTP(otp)} (type: ${type})`);
      
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      // Revoke previous pending OTPs
      await this.OTP.updateMany(
        { 
          email, 
          type, 
          status: "pending"
        },
        { 
          status: "revoked",
          updatedAt: new Date()
        }
      );

      const newOTP = new this.OTP({
        id: randomUUID(),
        email,
        originalOtp: otp,
        maskedOtp: this.maskOTP(otp),
        type,
        userId,
        expiresAt,
        status: "pending",
        ...metadata,
        createdAt: new Date()
      });

      const savedOTP = await newOTP.save();
      
      return {
        id: savedOTP.id,
        otp: savedOTP.originalOtp,
        maskedOtp: savedOTP.maskedOtp
      };
      
    } catch (error) {
      console.error(`Error creating OTP for ${email}:`, error.message);
      throw error;
    }
  }

  async getValidOTP(email, otp, type = null, metadata = {}) {
    try {
      const now = new Date();
      const query = {
        email: email.trim().toLowerCase(),
        originalOtp: otp,
        expiresAt: { $gt: now },
        status: "pending"
      };

      if (type) {
        query.type = type;
      }
      
      const foundOTP = await this.OTP.findOne(query).sort({ createdAt: -1 });
      
      if (foundOTP) {
        console.log(`OTP verified for ${email}: ${this.maskOTP(otp)}`);
        foundOTP.attempts += 1;
        
        if (metadata.ipAddress) {
          foundOTP.ipAddress = metadata.ipAddress;
        }
        if (metadata.userAgent) {
          foundOTP.userAgent = metadata.userAgent;
        }
        
        await foundOTP.save();
        return foundOTP;
      }
      
      console.log(`Invalid OTP attempt for ${email}: ${this.maskOTP(otp)}`);
      return null;
    } catch (error) {
      console.error(`Error verifying OTP for ${email}:`, error.message);
      throw error;
    }
  }

  async consumeOTP(email, otp = null, metadata = {}) {
    try {
      const query = { 
        email: email.trim().toLowerCase(), 
        status: "pending"
      };
      
      if (otp) {
        query.originalOtp = otp;
      }

      const updateData = {
        status: "consumed",
        consumedAt: new Date(),
        maskedOtp: this.fullyMaskOTP(otp),
        updatedAt: new Date(),
        $set: {
          ...metadata,
          consumptionReason: "verified_successfully"
        }
      };

      const result = await this.OTP.updateMany(query, updateData);
      
      if (result.modifiedCount > 0) {
        console.log(`OTP consumed for ${email}`);
      }
      
      return result.modifiedCount > 0;
      
    } catch (error) {
      console.error(`Error consuming OTP for ${email}:`, error.message);
      throw error;
    }
  }

  async markOTPAsUsed(email, otp = null) {
    return this.consumeOTP(email, otp, { 
      compatibilityMode: "markOTPAsUsed" 
    });
  }

  async getRecentOTPAttempts(email, minutes = 10) {
    try {
      const timeLimit = new Date(Date.now() - minutes * 60 * 1000);
      const count = await this.OTP.countDocuments({
        email: email.trim().toLowerCase(),
        createdAt: { $gt: timeLimit },
        status: "pending"
      });
      
      return count;
    } catch (error) {
      console.error(`Error getting OTP attempts for ${email}:`, error.message);
      throw error;
    }
  }

  async getOTPStatus(email, otp = null) {
    try {
      const query = { email: email.trim().toLowerCase() };
      if (otp) {
        query.originalOtp = otp;
      }

      const otpDoc = await this.OTP.findOne(query).sort({ createdAt: -1 });
      
      if (!otpDoc) {
        return {
          exists: false,
          status: "not_found",
          message: "No OTP found for this email"
        };
      }

      const now = new Date();
      const isExpired = otpDoc.expiresAt < now;
      
      let actualStatus = otpDoc.status;
      if (actualStatus === "pending" && isExpired) {
        actualStatus = "expired";
      }

      return {
        exists: true,
        id: otpDoc.id,
        email: otpDoc.email,
        originalOtp: actualStatus === "consumed" || actualStatus === "revoked" 
          ? this.fullyMaskOTP(otpDoc.originalOtp) 
          : this.maskOTP(otpDoc.originalOtp),
        maskedOtp: otpDoc.maskedOtp,
        type: otpDoc.type,
        status: actualStatus,
        isExpired,
        attempts: otpDoc.attempts,
        createdAt: otpDoc.createdAt,
        expiresAt: otpDoc.expiresAt,
        consumedAt: otpDoc.consumedAt,
        canBeUsed: actualStatus === "pending" && !isExpired
      };
      
    } catch (error) {
      console.error(`Error getting OTP status for ${email}:`, error.message);
      throw error;
    }
  }

  async cleanupExpiredOTPs() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const deleteResult = await this.OTP.deleteMany({
        createdAt: { $lt: thirtyDaysAgo }
      });
      
      if (deleteResult.deletedCount > 0) {
        console.log(`Cleaned up ${deleteResult.deletedCount} expired OTPs`);
      }
      
      return deleteResult.deletedCount;
      
    } catch (error) {
      console.error("Error cleaning up OTPs:", error.message);
      throw error;
    }
  }

  // ==================== USER METHODS ====================

  async getUserByEmail(email) {
    try {
      const user = await this.User.findOne({ email: email.trim().toLowerCase() });
      return user ? user.toObject() : undefined;
    } catch (error) {
      console.error(`Error finding user by email ${email}:`, error.message);
      throw error;
    }
  }

  async getUser(id) {
    try {
      let user = await this.User.findOne({ id });
      if (!user) {
        user = await this.User.findById(id);
      }
      return user ? user.toObject() : undefined;
    } catch (error) {
      console.error(`Error getting user ${id}:`, error.message);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      const user = await this.User.findOne({ username });
      return user ? user.toObject() : undefined;
    } catch (error) {
      console.error(`Error finding user by username ${username}:`, error.message);
      throw error;
    }
  }

  async createUser(userData) {
    try {
      console.log(`Creating user: ${userData.email}`);
      
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);

      const newUser = new this.User({
        ...userData,
        id: randomUUID(),
        password: hashedPassword,
      });

      await newUser.save();
      return newUser.toObject();
    } catch (error) {
      console.error(`Error creating user ${userData.email}:`, error.message);
      throw error;
    }
  }

  async updateUserPassword(userId, newPassword) {
    try {
      let user = await this.User.findOne({ id: userId });
      if (!user) {
        user = await this.User.findById(userId);
      }

      if (!user) {
        return undefined;
      }

      user.password = newPassword;
      user.updatedAt = new Date();

      const result = await user.save();
      console.log(`Password updated for user: ${user.email}`);
      return result.toObject();
    } catch (error) {
      console.error(`Error updating password for user ${userId}:`, error.message);
      throw error;
    }
  }

  async updateUser(id, updateData) {
    try {
      const dataToUpdate = { ...updateData };
      delete dataToUpdate.password;

      const result = await this.User.findOneAndUpdate(
        { id },
        { ...dataToUpdate, updatedAt: new Date() },
        { new: true }
      );
      return result ? result.toObject() : undefined;
    } catch (error) {
      console.error(`Error updating user ${id}:`, error.message);
      throw error;
    }
  }

  async deleteUser(id) {
    try {
      const result = await this.User.deleteOne({ id });
      console.log(`User ${id} deleted: ${result.deletedCount > 0 ? "success" : "not found"}`);
      return result.deletedCount > 0;
    } catch (error) {
      console.error(`Error deleting user ${id}:`, error.message);
      throw error;
    }
  }

  async getAllUsers() {
    try {
      const users = await this.User.find();
      return users.map(user => user.toObject());
    } catch (error) {
      console.error("Error getting all users:", error.message);
      throw error;
    }
  }

  async updateUserLastLogin(userId) {
    try {
      const result = await this.User.findOneAndUpdate(
        { id: userId },
        {
          lastLogin: new Date().toISOString(),
          updatedAt: new Date()
        },
        { new: true }
      );
      return result ? result.toObject() : undefined;
    } catch (error) {
      console.error(`Error updating last login for user ${userId}:`, error.message);
      throw error;
    }
  }

  // ==================== BUSINESS METHODS ====================

  async getBusiness(identifier) {
    try {
      let business = await this.Business.findOne({ id: identifier });
      if (business) {
        return business.toObject();
      }

      const businessIdNum = parseInt(identifier, 10);
      if (!isNaN(businessIdNum)) {
        business = await this.Business.findOne({ businessId: businessIdNum });
        if (business) {
          return business.toObject();
        }
      }

      business = await this.Business.findOne({ businessId: identifier });
      if (business) {
        return business.toObject();
      }

      return undefined;
    } catch (error) {
      console.error(`Error getting business ${identifier}:`, error.message);
      throw error;
    }
  }

  async generateBusinessId() {
    try {
      const highestBusiness = await this.Business.findOne(
        { businessId: { $ne: 0 } },
        { businessId: 1 },
        { sort: { businessId: -1 } }
      );

      if (!highestBusiness) {
        return 1;
      }

      return highestBusiness.businessId + 1;
    } catch (error) {
      console.error("Error generating business ID:", error.message);
      throw error;
    }
  }

  async createBusiness(businessData) {
    try {
      console.log(`Creating business: ${businessData.businessName}`);
      
      const businessId = await this.generateBusinessId();

      const newBusiness = new this.Business({
        ...businessData,
        id: randomUUID(),
        businessId,
      });

      await newBusiness.save();
      return newBusiness.toObject();
    } catch (error) {
      console.error(`Error creating business ${businessData.businessName}:`, error.message);
      throw error;
    }
  }

  async getBusinessByRegistrationNumber(regNumber) {
    try {
      const business = await this.Business.findOne({ registrationNumber: regNumber });
      return business ? business.toObject() : undefined;
    } catch (error) {
      console.error(`Error getting business by reg number ${regNumber}:`, error.message);
      throw error;
    }
  }

  async getBusinessByName(name) {
    try {
      const business = await this.Business.findOne({ businessName: name });
      return business ? business.toObject() : undefined;
    } catch (error) {
      console.error(`Error getting business by name ${name}:`, error.message);
      throw error;
    }
  }

  async getBusinesses() {
    try {
      const businesses = await this.Business.find().sort({ businessId: 1 });
      return businesses.map(business => business.toObject());
    } catch (error) {
      console.error("Error getting businesses:", error.message);
      throw error;
    }
  }

  async updateBusiness(id, updateData) {
    try {
      const dataToUpdate = { ...updateData };
      delete dataToUpdate.registrationNumber;
      delete dataToUpdate.owner;
      delete dataToUpdate.logoFile;

      const result = await this.Business.findOneAndUpdate(
        { id },
        { ...dataToUpdate, updatedAt: new Date() },
        { new: true }
      );
      return result ? result.toObject() : undefined;
    } catch (error) {
      console.error(`Error updating business ${id}:`, error.message);
      throw error;
    }
  }

  async deleteBusiness(id) {
    try {
      const result = await this.Business.deleteOne({ id });
      console.log(`Business ${id} deleted: ${result.deletedCount > 0 ? "success" : "not found"}`);
      return result.deletedCount > 0;
    } catch (error) {
      console.error(`Error deleting business ${id}:`, error.message);
      throw error;
    }
  }

  async getBusinessUsers(businessId) {
    try {
      const users = await this.User.find({ associatedBusinessId: businessId.toString() });
      return users.map(user => user.toObject());
    } catch (error) {
      console.error(`Error getting users for business ${businessId}:`, error.message);
      throw error;
    }
  }

  async getBusinessByBusinessId(businessId) {
    try {
      const numericId = Number(businessId);
      if (isNaN(numericId)) {
        return undefined;
      }

      const business = await this.Business.findOne({ businessId: numericId });
      return business ? business.toObject() : undefined;
    } catch (error) {
      console.error(`Error getting business by businessId ${businessId}:`, error.message);
      throw error;
    }
  }

  async getBusinessByIdentifier(identifier) {
    try {
      const businessIdNum = parseInt(identifier, 10);
      if (!isNaN(businessIdNum)) {
        const businessByNumericId = await this.Business.findOne({ businessId: businessIdNum });
        if (businessByNumericId) return businessByNumericId.toObject();
      }
      const businessByUUID = await this.Business.findOne({ id: identifier });
      if (businessByUUID) return businessByUUID.toObject();
      const businessByReg = await this.Business.findOne({ registrationNumber: identifier });
      if (businessByReg) return businessByReg.toObject();
      const businessByName = await this.Business.findOne({ businessName: identifier });
      if (businessByName) return businessByName.toObject();

      return undefined;
    } catch (error) {
      console.error(`Error getting business by identifier ${identifier}:`, error.message);
      throw error;
    }
  }
}