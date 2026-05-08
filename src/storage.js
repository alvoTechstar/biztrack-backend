// This file defines the IStorage interface and exports a concrete implementation.

/**
 * @typedef {import("./schema.js").User} User
 * @typedef {import("./schema.js").InsertUser} InsertUser
 * @typedef {import("./schema.js").BlogPost} BlogPost
 * @typedef {import("./schema.js").InsertBlogPost} InsertBlogPost
 * @typedef {import("./schema.js").ContactMessage} ContactMessage
 * @typedef {import("./schema.js").InsertContactMessage} InsertContactMessage
 * @typedef {import("./schema.js").GivingRecord} GivingRecord
 * @typedef {import("./schema.js").InsertGivingRecord} InsertGivingRecord
 */

/**
 * @interface IStorage
 * Defines the methods for data persistence.
 */
export class IStorage {
    /**
     * @param {string} id
     * @returns {Promise<User | undefined>}
     */
    async getUser(id) {}

    /**
     * @param {string} username
     * @returns {Promise<User | undefined>}
     */
    async getUserByUsername(username) {}

    /**
     * @param {InsertUser} user
     * @returns {Promise<User>}
     */
    async createUser(user) {}

    /**
     * @param {number} [limit]
     * @returns {Promise<BlogPost[]>}
     */
    async getBlogPosts(limit) {}

    /**
     * @param {string} id
     * @returns {Promise<BlogPost | undefined>}
     */
    async getBlogPost(id) {}

    /**
     * @param {InsertBlogPost} post
     * @returns {Promise<BlogPost>}
     */
    async createBlogPost(post) {}

    /**
     * @param {string} category
     * @returns {Promise<BlogPost[]>}
     */
    async getBlogPostsByCategory(category) {}

    /**
     * @param {InsertContactMessage} message
     * @returns {Promise<ContactMessage>}
     */
    async createContactMessage(message) {}

    /**
     * @returns {Promise<ContactMessage[]>}
     */
    async getContactMessages() {}

    /**
     * @param {InsertGivingRecord} record
     * @returns {Promise<GivingRecord>}
     */
    async createGivingRecord(record) {}

    /**
     * @returns {Promise<GivingRecord[]>}
     */
    async getGivingRecords() {}

    /**
     * @param {string} id
     * @param {string} status
     * @param {string} [transactionId]
     * @returns {Promise<GivingRecord | undefined>}
     */
    async updateGivingRecordStatus(id, status, transactionId) {}
}

// Switch between MongoDB and PostgreSQL by swapping the import below.
// MongoDB:    import { MongoStorage } from "./mongoStorage.js";  const storage = new MongoStorage();
// PostgreSQL: import { PgStorage }    from "./pgStorage.js";     const storage = new PgStorage();
import { PgStorage } from "./pgStorage.js";

export const storage = new PgStorage();