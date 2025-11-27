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

// Create Mongoose models
const User = mongoose.model('User', userSchema);
const Business = mongoose.model('Business', businessSchema);

export class MongoStorage {
  constructor() {
    this.User = User;
    this.Business = Business;
  }

  async initialize() {
    await this.createDefaultSetup();
    console.log("MongoStorage initialized with Mongoose - Users and Businesses only");
  }

  async createDefaultSetup() {
    try {
      console.log("🔧 Checking for default business and admin...");

      const existingBusiness = await this.Business.findOne({ businessName: "BizTrack Application" });
      let businessId;

      if (existingBusiness) {
        console.log('✅ Default business already exists');
        businessId = existingBusiness.businessId;
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
          logoUrl: "/assets/biztrack-logo.png",
          primaryColor: "#4F46E5", 
          status: "active",
        });

        await defaultBusiness.save();
        businessId = defaultBusiness.businessId;
        console.log('✅ Default business created successfully!');
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
          associatedBusinessId: businessId.toString(),
          institutionId: businessId.toString(),
          institutionName: "BizTrack Application",
          status: "ACTIVE",
          permissions: ["read", "write", "delete", "admin", "super_admin"],
          lastLogin: "Never",
        });

        await defaultAdmin.save();
        console.log('✅ Default super admin user created successfully!');
      }

      console.log('\n📋 DEFAULT LOGIN CREDENTIALS:');
      console.log('─────────────────────────────');
      console.log('Email:    admin@biztrack.com');
      console.log('Password: Admin123!');
      console.log('Role:     Super_Admin');
      console.log('Business: BizTrack Application');
      console.log('─────────────────────────────\n');

    } catch (error) {
      console.error('❌ Error creating default setup:', error);
    }
  }

  // === USER METHODS ===
  
  async getUser(id) {
    try {
      // Try to find by custom id first
      let user = await this.User.findOne({ id });
      
      // If not found, try by MongoDB _id
      if (!user) {
        user = await this.User.findById(id);
      }
      
      return user ?? undefined;
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }

  async getUserByEmail(email) {
    try {
      const user = await this.User.findOne({ email });
      return user ?? undefined;
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      const user = await this.User.findOne({ username });
      return user ?? undefined;
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }

  async createUser(userData) {
    try {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
      
      const newUser = new this.User({
        ...userData,
        id: randomUUID(),
        password: hashedPassword,
      });

      await newUser.save();
      return newUser;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUserPassword(userId, newPassword) {
    try {
      console.log("🔐 Updating password for user ID:", userId);
      
      // Try to find user by custom id field first
      let user = await this.User.findOne({ id: userId });
      
      // If not found by custom id, try by MongoDB _id
      if (!user) {
        user = await this.User.findById(userId);
      }
      
      if (!user) {
        console.log("❌ User not found with ID:", userId);
        return undefined;
      }

      console.log("✅ User found:", user.email);
      
      // Update the password directly on the user object and save
      user.password = newPassword;
      user.updatedAt = new Date();
      
      const result = await user.save();
      console.log("✅ Password updated successfully for:", user.email);
      
      return result;
    } catch (error) {
      console.error('❌ Error updating user password:', error);
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
      return result ?? undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(id) {
    try {
      const result = await this.User.deleteOne({ id });
      return result.deletedCount > 0;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  async getAllUsers() {
    try {
      return await this.User.find();
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }

  // === BUSINESS METHODS ===

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
      console.error('Error generating business ID:', error);
      const count = await this.Business.countDocuments({ businessId: { $ne: 0 } });
      return count + 1;
    }
  }

  async createBusiness(businessData) {
    console.log("📝 Creating business with data:", businessData);
    
    const businessId = await this.generateBusinessId();
    console.log("🔢 Generated Business ID:", businessId);
    
    const newBusiness = new this.Business({
      ...businessData,
      id: randomUUID(),
      businessId,
    });
    
    await newBusiness.save();
    return newBusiness;
  }
  
  async getBusinessByRegistrationNumber(regNumber) {
    const business = await this.Business.findOne({ registrationNumber: regNumber });
    return business ?? undefined;
  }
  
  async getBusinessByName(name) {
    const business = await this.Business.findOne({ businessName: name });
    return business ?? undefined;
  }

  async getBusiness(id) {
    const business = await this.Business.findOne({ id });
    return business ?? undefined;
  }

  async getBusinessByBusinessId(businessId) {
    const business = await this.Business.findOne({ businessId });
    return business ?? undefined;
  }

  async getBusinesses() {
    return await this.Business.find().sort({ businessId: 1 });
  }

  async updateBusiness(id, updateData) {
    const dataToUpdate = { ...updateData };
    delete dataToUpdate.registrationNumber;
    delete dataToUpdate.owner;
    delete dataToUpdate.logoFile;
    
    const result = await this.Business.findOneAndUpdate(
      { id },
      { ...dataToUpdate, updatedAt: new Date() },
      { new: true }
    );
    return result ?? undefined;
  }

  async deleteBusiness(id) {
    const result = await this.Business.deleteOne({ id });
    return result.deletedCount > 0;
  }

  // === UTILITY METHODS ===
  
  async getUserByBusinessId(businessId) {
    const user = await this.User.findOne({ associatedBusinessId: businessId.toString() });
    return user ?? undefined;
  }

  async getBusinessUsers(businessId) {
    return await this.User.find({ associatedBusinessId: businessId.toString() });
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
      return result ?? undefined;
    } catch (error) {
      console.error('Error updating user last login:', error);
      throw error;
    }
  }

  async migrateDefaultBusiness() {
    try {
      const defaultBusiness = await this.Business.findOne({ businessName: "BizTrack Application" });
      if (defaultBusiness && defaultBusiness.businessId === "BIZ-TRACK-DEFAULT") {
        console.log("🔄 Migrating default business ID from string to number...");
        defaultBusiness.businessId = 0;
        await defaultBusiness.save();
        console.log("✅ Default business migration completed");
      }
    } catch (error) {
      console.error("❌ Error migrating default business:", error);
    }
  }
}