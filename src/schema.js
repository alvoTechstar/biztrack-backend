// src/schemas/index.js
import { z } from "zod";

// --- User Schemas ---

export const userSchema = z.object({
  id: z.string().optional(),
  username: z.string().min(1, "Username is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email format"),
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(6, "Password must be at least 6 characters long").optional(),
  // Updated role enum to match your frontend roles
  role: z.enum([
    "Super_Admin", 
    "Biztrack_ADMIN",
    "Hotel_Admin", "Hotel_Cashier", "Hotel_Waiter",
    "Kiosk_Admin", "Kiosk_Shopkeeper", 
    "Hospital_Admin", "Doctor", "Nurse", "Lab_Technician", "Receptionist", "Pharmacist",
  ]).default("Staff"),
  businessName: z.string().optional().default(""),
  associatedBusinessId: z.string().optional().default(""),
  // Add institutionId to match your form
  institutionId: z.string().optional().default(""),
  institutionName: z.string().optional().default(""),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  permissions: z.array(z.string()).optional().default(["read", "write", "delete"]),
  lastLogin: z.string().optional().default("Never"),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const insertUserSchema = userSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // Make password required for new users
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

// Update user schema (partial updates allowed)
export const updateUserSchema = insertUserSchema.partial().extend({
  id: z.string(),
});

export const User = userSchema;
export const InsertUser = insertUserSchema;
export const UpdateUser = updateUserSchema;

// ------------------------------------------

// Business schema (unchanged)
export const businessSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().optional(),
  businessName: z.string().min(1, "Business name is required"),
  registrationNumber: z.string().min(1, "Registration number is required"), 
  businessType: z.enum(["Hotel", "Kiosk", "Hospital", "Retail", "Other"], {
    errorMap: () => ({ message: "Business type is required and must be one of the allowed types" })
  }),
  email: z.string().email("Invalid email format"),
  phone: z.string().min(1, "Phone number is required"),
  address: z.string().optional().default(""),
  website: z.string().url("Invalid URL format").or(z.literal("")).or(z.literal(null)).optional().default(""),
  description: z.string().optional().default(""),
  logoUrl: z.string().url("Invalid URL format").or(z.literal("")).or(z.literal(null)).optional().default(""),
  primaryColor: z.string()
    .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color code")
    .default("#000000"),
  owner: z.string().min(1, "Owner is required"),
  status: z.enum(["active", "inactive"]).default("active"),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const insertBusinessSchema = businessSchema.omit({
  id: true,
  businessId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
});

export const updateBusinessSchema = businessSchema.omit({
  id: true,
  businessId: true, 
  registrationNumber: true,
  owner: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
}).partial();

export const Business = businessSchema;
export const InsertBusiness = insertBusinessSchema;
export const UpdateBusiness = updateBusinessSchema;