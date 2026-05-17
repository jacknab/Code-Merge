import { 
  locations, services, staff, customers, appointments, products,
  serviceCategories, addons, serviceAddons, appointmentAddons, staffServices, staffAvailability,
  calendarSettings, cashDrawerSessions, drawerActions, businessHours,
  smsSettings, smsLog, mailSettings, stripeSettings,
  type Store, type InsertStore,
  type ServiceCategory, type InsertServiceCategory,
  type Service, type InsertService,
  type Addon, type InsertAddon,
  type ServiceAddon, type InsertServiceAddon,
  type AppointmentAddon, type InsertAppointmentAddon,
  type Staff, type InsertStaff,
  type StaffService, type InsertStaffService,
  type StaffAvailability, type InsertStaffAvailability,
  type BusinessHours, type InsertBusinessHours,
  type CalendarSettings, type InsertCalendarSettings,
  type Customer, type InsertCustomer,
  type Appointment, type InsertAppointment, type AppointmentWithDetails,
  type Product, type InsertProduct,
  type CashDrawerSession, type InsertCashDrawerSession, type CashDrawerSessionWithActions,
  type DrawerAction, type InsertDrawerAction,
  type SmsSettings, type InsertSmsSettings,
  type SmsLogEntry, type InsertSmsLog,
  type MailSettings, type InsertMailSettings,
  type StripeSettings, type InsertStripeSettings
} from "@shared/schema";
import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "./db";
import { eq, and, gte, lte, inArray, desc, isNotNull } from "drizzle-orm";

export interface IStorage {
  getStores(userId?: string): Promise<Store[]>;
  getStore(id: number): Promise<Store | undefined>;
  getStoreBySlug(slug: string): Promise<Store | undefined>;
  createStore(store: InsertStore): Promise<Store>;
  updateStore(id: number, store: Partial<InsertStore>): Promise<Store | undefined>;

  getBusinessHours(storeId: number): Promise<BusinessHours[]>;
  setBusinessHours(storeId: number, hours: InsertBusinessHours[]): Promise<BusinessHours[]>;

  getServiceCategories(storeId?: number): Promise<ServiceCategory[]>;
  createServiceCategory(cat: InsertServiceCategory): Promise<ServiceCategory>;
  updateServiceCategory(id: number, cat: Partial<InsertServiceCategory>): Promise<ServiceCategory | undefined>;
  deleteServiceCategory(id: number): Promise<void>;

  getServices(storeId?: number): Promise<Service[]>;
  getService(id: number): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: number, service: Partial<InsertService>): Promise<Service | undefined>;
  deleteService(id: number): Promise<void>;

  getAddons(storeId?: number): Promise<Addon[]>;
  getAddon(id: number): Promise<Addon | undefined>;
  createAddon(addon: InsertAddon): Promise<Addon>;
  updateAddon(id: number, addon: Partial<InsertAddon>): Promise<Addon | undefined>;
  deleteAddon(id: number): Promise<void>;

  getServiceAddons(serviceId?: number): Promise<(ServiceAddon & { addon: Addon })[]>;
  getAllServiceAddonMappings(): Promise<ServiceAddon[]>;
  getAddonsForService(serviceId: number): Promise<Addon[]>;
  getServicesForAddon(addonId: number): Promise<ServiceAddon[]>;
  setAddonServices(addonId: number, serviceIds: number[]): Promise<void>;
  createServiceAddon(sa: InsertServiceAddon): Promise<ServiceAddon>;
  deleteServiceAddon(id: number): Promise<void>;

  getAppointmentAddons(appointmentId: number): Promise<(AppointmentAddon & { addon: Addon })[]>;
  setAppointmentAddons(appointmentId: number, addonIds: number[]): Promise<void>;

  getAllStaff(storeId?: number): Promise<Staff[]>;
  getStaffMember(id: number): Promise<Staff | undefined>;
  createStaff(staffMember: InsertStaff): Promise<Staff>;
  updateStaff(id: number, staffMember: Partial<InsertStaff>): Promise<Staff | undefined>;
  deleteStaff(id: number): Promise<void>;

  getStaffServices(staffId?: number, serviceId?: number): Promise<StaffService[]>;
  getStaffForService(serviceId: number): Promise<Staff[]>;
  setStaffServices(staffId: number, serviceIds: number[]): Promise<void>;

  getStaffAvailability(staffId: number): Promise<StaffAvailability[]>;
  setStaffAvailability(staffId: number, rules: InsertStaffAvailability[]): Promise<StaffAvailability[]>;
  deleteStaffAvailabilityRule(id: number): Promise<void>;

  getCustomers(storeId?: number): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  searchCustomerByPhone(phone: string, storeId: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: number, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: number): Promise<void>;

  getAppointments(filters?: { from?: Date; to?: Date; staffId?: number; storeId?: number; customerId?: number }): Promise<AppointmentWithDetails[]>;
  getAppointmentsByCustomerPhone(phoneDigits: string, storeId?: number): Promise<AppointmentWithDetails[]>;
  getAppointment(id: number): Promise<AppointmentWithDetails | undefined>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  updateAppointment(id: number, appointment: Partial<InsertAppointment>): Promise<Appointment | undefined>;
  deleteAppointment(id: number): Promise<void>;

  getProducts(storeId?: number): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<void>;

  getCalendarSettings(storeId: number): Promise<CalendarSettings | undefined>;
  upsertCalendarSettings(storeId: number, settings: Partial<InsertCalendarSettings>): Promise<CalendarSettings>;

  getCashDrawerSessions(storeId: number): Promise<CashDrawerSessionWithActions[]>;
  getCashDrawerSession(id: number): Promise<CashDrawerSessionWithActions | undefined>;
  getOpenCashDrawerSession(storeId: number): Promise<CashDrawerSessionWithActions | undefined>;
  createCashDrawerSession(session: InsertCashDrawerSession): Promise<CashDrawerSession>;
  updateCashDrawerSession(id: number, data: Partial<InsertCashDrawerSession>): Promise<CashDrawerSession | undefined>;
  createDrawerAction(action: InsertDrawerAction): Promise<DrawerAction>;
  getDrawerActions(sessionId: number): Promise<DrawerAction[]>;

  getSmsSettings(storeId: number): Promise<SmsSettings | undefined>;
  upsertSmsSettings(storeId: number, settings: Partial<InsertSmsSettings>): Promise<SmsSettings>;
  createSmsLog(log: InsertSmsLog): Promise<SmsLogEntry>;
  getSmsLogs(storeId: number, limit?: number): Promise<SmsLogEntry[]>;
  getAppointmentsNeedingReminders(fromTime: Date, toTime: Date): Promise<AppointmentWithDetails[]>;
  getRecentlyCompletedAppointments(fromTime: Date, toTime: Date): Promise<AppointmentWithDetails[]>;
  getSmsLogByAppointmentAndType(appointmentId: number, messageType: string): Promise<SmsLogEntry | undefined>;

  getMailSettings(storeId: number): Promise<MailSettings | undefined>;
  upsertMailSettings(storeId: number, settings: Partial<InsertMailSettings>): Promise<MailSettings>;

  getStripeSettings(storeId: number): Promise<StripeSettings | undefined>;
  upsertStripeSettings(storeId: number, settings: Partial<InsertStripeSettings>): Promise<StripeSettings>;

  // User Auth
  getUser(id: string): Promise<User | undefined>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, user: Partial<UpsertUser>): Promise<User | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Stores
  async getStores(userId?: string): Promise<Store[]> {
    if (userId) {
      return await db.select().from(locations).where(eq(locations.userId, userId));
    }
    return await db.select().from(locations);
  }
  async getStore(id: number): Promise<Store | undefined> {
    const [store] = await db.select().from(locations).where(eq(locations.id, id));
    return store;
  }
  async getStoreBySlug(slug: string): Promise<Store | undefined> {
    const [store] = await db.select().from(locations).where(eq(locations.bookingSlug, slug));
    return store;
  }
  async createStore(insertStore: InsertStore): Promise<Store> {
    const [store] = await db.insert(locations).values(insertStore).returning();
    return store;
  }
  async updateStore(id: number, data: Partial<InsertStore>): Promise<Store | undefined> {
    const [store] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
    return store;
  }

  async getBusinessHours(storeId: number): Promise<BusinessHours[]> {
    return await db.select().from(businessHours).where(eq(businessHours.storeId, storeId));
  }
  async setBusinessHours(storeId: number, hours: InsertBusinessHours[]): Promise<BusinessHours[]> {
    await db.delete(businessHours).where(eq(businessHours.storeId, storeId));
    if (hours.length === 0) return [];
    const result = await db.insert(businessHours).values(hours).returning();
    return result;
  }

  // Service Categories
  async getServiceCategories(storeId?: number): Promise<ServiceCategory[]> {
    if (storeId) {
      return await db.select().from(serviceCategories)
        .where(eq(serviceCategories.storeId, storeId))
        .orderBy(serviceCategories.sortOrder, serviceCategories.name);
    }
    return await db.select().from(serviceCategories)
      .orderBy(serviceCategories.sortOrder, serviceCategories.name);
  }
  async createServiceCategory(cat: InsertServiceCategory): Promise<ServiceCategory> {
    const [result] = await db.insert(serviceCategories).values(cat).returning();
    return result;
  }
  async updateServiceCategory(id: number, cat: Partial<InsertServiceCategory>): Promise<ServiceCategory | undefined> {
    const [result] = await db.update(serviceCategories).set(cat).where(eq(serviceCategories.id, id)).returning();
    return result;
  }
  async deleteServiceCategory(id: number): Promise<void> {
    // Unlink services from this category first
    // This allows us to hard delete the category without violating FK constraints
    await db.update(services)
      .set({ categoryId: null, category: "Uncategorized" })
      .where(eq(services.categoryId, id));
    
    await db.delete(serviceCategories).where(eq(serviceCategories.id, id));
  }

  // Services
  async getServices(storeId?: number): Promise<Service[]> {
    if (storeId) return await db.select().from(services).where(eq(services.storeId, storeId));
    return await db.select().from(services);
  }
  async getService(id: number): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }
  async createService(insertService: InsertService): Promise<Service> {
    const [service] = await db.insert(services).values(insertService).returning();
    return service;
  }
  async updateService(id: number, updateData: Partial<InsertService>): Promise<Service | undefined> {
    const [service] = await db.update(services).set(updateData).where(eq(services.id, id)).returning();
    return service;
  }
  async deleteService(id: number): Promise<void> {
    // Clean up dependencies first
    await db.delete(serviceAddons).where(eq(serviceAddons.serviceId, id));
    await db.delete(staffServices).where(eq(staffServices.serviceId, id));
    
    // For appointments, we want to keep the record but unlink the service
    // This allows us to hard delete the service without violating FK constraints
    await db.update(appointments)
      .set({ serviceId: null })
      .where(eq(appointments.serviceId, id));

    await db.delete(services).where(eq(services.id, id));
  }

  // Addons
  async getAddons(storeId?: number): Promise<Addon[]> {
    if (storeId) return await db.select().from(addons).where(eq(addons.storeId, storeId));
    return await db.select().from(addons);
  }
  async getAddon(id: number): Promise<Addon | undefined> {
    const [addon] = await db.select().from(addons).where(eq(addons.id, id));
    return addon;
  }
  async createAddon(insertAddon: InsertAddon): Promise<Addon> {
    const [addon] = await db.insert(addons).values(insertAddon).returning();
    return addon;
  }
  async updateAddon(id: number, updateData: Partial<InsertAddon>): Promise<Addon | undefined> {
    const [addon] = await db.update(addons).set(updateData).where(eq(addons.id, id)).returning();
    return addon;
  }
  async deleteAddon(id: number): Promise<void> {
    // Clean up dependencies
    await db.delete(serviceAddons).where(eq(serviceAddons.addonId, id));
    await db.delete(appointmentAddons).where(eq(appointmentAddons.addonId, id));

    // Now safe to delete the addon
    await db.delete(addons).where(eq(addons.id, id));
  }

  // Service Addons
  async getServiceAddons(serviceId?: number): Promise<(ServiceAddon & { addon: Addon })[]> {
    const result = await db.query.serviceAddons.findMany({
      where: serviceId ? eq(serviceAddons.serviceId, serviceId) : undefined,
      with: { addon: true },
    });
    return result as any;
  }
  async getAllServiceAddonMappings(): Promise<ServiceAddon[]> {
    return await db.select().from(serviceAddons);
  }
  async getAddonsForService(serviceId: number): Promise<Addon[]> {
    const result = await db.query.serviceAddons.findMany({
      where: eq(serviceAddons.serviceId, serviceId),
      with: { addon: true },
    });
    return result.map((sa: any) => sa.addon);
  }
  async getServicesForAddon(addonId: number): Promise<ServiceAddon[]> {
    return await db.select().from(serviceAddons).where(eq(serviceAddons.addonId, addonId));
  }
  async setAddonServices(addonId: number, serviceIds: number[]): Promise<void> {
    await db.delete(serviceAddons).where(eq(serviceAddons.addonId, addonId));
    if (serviceIds.length > 0) {
      await db.insert(serviceAddons).values(
        serviceIds.map(serviceId => ({ serviceId, addonId }))
      );
    }
  }
  async createServiceAddon(sa: InsertServiceAddon): Promise<ServiceAddon> {
    const [result] = await db.insert(serviceAddons).values(sa).returning();
    return result;
  }
  async deleteServiceAddon(id: number): Promise<void> {
    await db.delete(serviceAddons).where(eq(serviceAddons.id, id));
  }

  // Appointment Addons
  async getAppointmentAddons(appointmentId: number): Promise<(AppointmentAddon & { addon: Addon })[]> {
    const result = await db.query.appointmentAddons.findMany({
      where: eq(appointmentAddons.appointmentId, appointmentId),
      with: { addon: true },
    });
    return result as any;
  }
  async setAppointmentAddons(appointmentId: number, addonIds: number[]): Promise<void> {
    await db.delete(appointmentAddons).where(eq(appointmentAddons.appointmentId, appointmentId));
    if (addonIds.length > 0) {
      await db.insert(appointmentAddons).values(
        addonIds.map(addonId => ({ appointmentId, addonId }))
      );
    }
  }

  // Staff
  async getAllStaff(storeId?: number): Promise<Staff[]> {
    if (storeId) return await db.select().from(staff).where(eq(staff.storeId, storeId));
    return await db.select().from(staff);
  }
  async getStaffMember(id: number): Promise<Staff | undefined> {
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, id));
    return staffMember;
  }
  async createStaff(insertStaff: InsertStaff): Promise<Staff> {
    const [staffMember] = await db.insert(staff).values(insertStaff).returning();
    return staffMember;
  }
  async updateStaff(id: number, updateData: Partial<InsertStaff>): Promise<Staff | undefined> {
    const [staffMember] = await db.update(staff).set(updateData).where(eq(staff.id, id)).returning();
    return staffMember;
  }
  async deleteStaff(id: number): Promise<void> {
    await db.delete(staffServices).where(eq(staffServices.staffId, id));
    await db.delete(staff).where(eq(staff.id, id));
  }

  // Staff Services
  async getStaffServices(staffId?: number, serviceId?: number): Promise<StaffService[]> {
    const conditions = [];
    if (staffId) conditions.push(eq(staffServices.staffId, staffId));
    if (serviceId) conditions.push(eq(staffServices.serviceId, serviceId));
    return await db.select().from(staffServices).where(
      conditions.length > 0 ? and(...conditions) : undefined
    );
  }

  async getStaffForService(serviceId: number): Promise<Staff[]> {
    const result = await db.query.staffServices.findMany({
      where: eq(staffServices.serviceId, serviceId),
      with: { staff: true },
    });
    return result.map((ss: any) => ss.staff);
  }

  async setStaffServices(staffId: number, serviceIds: number[]): Promise<void> {
    await db.delete(staffServices).where(eq(staffServices.staffId, staffId));
    if (serviceIds.length > 0) {
      await db.insert(staffServices).values(
        serviceIds.map(serviceId => ({ staffId, serviceId }))
      );
    }
  }

  // Staff Availability
  async getStaffAvailability(staffId: number): Promise<StaffAvailability[]> {
    return await db.select().from(staffAvailability).where(eq(staffAvailability.staffId, staffId));
  }

  async setStaffAvailability(staffId: number, rules: InsertStaffAvailability[]): Promise<StaffAvailability[]> {
    await db.delete(staffAvailability).where(eq(staffAvailability.staffId, staffId));
    if (rules.length > 0) {
      const result = await db.insert(staffAvailability).values(
        rules.map(r => ({ ...r, staffId }))
      ).returning();
      return result;
    }
    return [];
  }

  async deleteStaffAvailabilityRule(id: number): Promise<void> {
    await db.delete(staffAvailability).where(eq(staffAvailability.id, id));
  }

  // Customers
  async getCustomers(storeId?: number): Promise<Customer[]> {
    if (storeId) return await db.select().from(customers).where(eq(customers.storeId, storeId));
    return await db.select().from(customers);
  }
  async getCustomer(id: number): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }
  async searchCustomerByPhone(phone: string, storeId: number): Promise<Customer | undefined> {
    const digits = phone.replace(/\D/g, "");
    const storeCustomers = await db.select().from(customers).where(eq(customers.storeId, storeId));
    return storeCustomers.find(c => (c.phone || "").replace(/\D/g, "") === digits);
  }
  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const [customer] = await db.insert(customers).values(insertCustomer).returning();
    return customer;
  }
  async updateCustomer(id: number, updateData: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const [customer] = await db.update(customers).set(updateData).where(eq(customers.id, id)).returning();
    return customer;
  }
  async deleteCustomer(id: number): Promise<void> {
    await db.delete(customers).where(eq(customers.id, id));
  }

  // Appointments
  async getAppointments(filters?: { from?: Date; to?: Date; staffId?: number; storeId?: number; customerId?: number }): Promise<AppointmentWithDetails[]> {
    const conditions = [];
    if (filters?.from) conditions.push(gte(appointments.date, filters.from));
    if (filters?.to) conditions.push(lte(appointments.date, filters.to));
    if (filters?.staffId) conditions.push(eq(appointments.staffId, filters.staffId));
    if (filters?.storeId) conditions.push(eq(appointments.storeId, filters.storeId));
    if (filters?.customerId) conditions.push(eq(appointments.customerId, filters.customerId));

    const result = await db.query.appointments.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        service: true,
        staff: true,
        customer: true,
        store: true,
        appointmentAddons: {
          with: { addon: true },
        },
      },
      orderBy: (appointments, { asc }) => [asc(appointments.date)],
    });
    
    return result as any;
  }

  async getAppointment(id: number): Promise<AppointmentWithDetails | undefined> {
    const result = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      with: {
        service: true,
        staff: true,
        customer: true,
        store: true,
        appointmentAddons: {
          with: { addon: true },
        },
      },
    });
    return result as any;
  }

  async createAppointment(insertAppointment: InsertAppointment): Promise<Appointment> {
    const [appointment] = await db.insert(appointments).values(insertAppointment).returning();
    return appointment;
  }

  async getAppointmentsByCustomerPhone(phoneDigits: string, storeId?: number): Promise<AppointmentWithDetails[]> {
    const digits = phoneDigits.replace(/\D/g, "");
    if (!digits) return [];

    const storeCustomers = storeId
      ? await db.select().from(customers).where(eq(customers.storeId, storeId))
      : await db.select().from(customers);

    const customerIds = storeCustomers
      .filter(c => (c.phone || "").replace(/\D/g, "") === digits)
      .map(c => c.id);

    if (customerIds.length === 0) return [];

    const where = storeId
      ? and(inArray(appointments.customerId, customerIds), eq(appointments.storeId, storeId))
      : inArray(appointments.customerId, customerIds);

    const result = await db.query.appointments.findMany({
      where,
      with: {
        service: true,
        staff: true,
        customer: true,
        store: true,
        appointmentAddons: {
          with: { addon: true },
        },
      },
      orderBy: (appointments, { desc }) => [desc(appointments.date)],
    });

    return result as AppointmentWithDetails[];
  }

  async updateAppointment(id: number, updateData: Partial<InsertAppointment>): Promise<Appointment | undefined> {
    const [appointment] = await db.update(appointments).set(updateData).where(eq(appointments.id, id)).returning();
    return appointment;
  }

  async deleteAppointment(id: number): Promise<void> {
    await db.delete(appointmentAddons).where(eq(appointmentAddons.appointmentId, id));
    await db.delete(appointments).where(eq(appointments.id, id));
  }

  // Products
  async getProducts(storeId?: number): Promise<Product[]> {
    if (storeId) return await db.select().from(products).where(eq(products.storeId, storeId));
    return await db.select().from(products);
  }
  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }
  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    return product;
  }
  async updateProduct(id: number, updateData: Partial<InsertProduct>): Promise<Product | undefined> {
    const [product] = await db.update(products).set(updateData).where(eq(products.id, id)).returning();
    return product;
  }
  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  // Calendar Settings
  async getCalendarSettings(storeId: number): Promise<CalendarSettings | undefined> {
    const [settings] = await db.select().from(calendarSettings).where(eq(calendarSettings.storeId, storeId));
    return settings;
  }

  async upsertCalendarSettings(storeId: number, settings: Partial<InsertCalendarSettings>): Promise<CalendarSettings> {
    const existing = await this.getCalendarSettings(storeId);
    if (existing) {
      const [updated] = await db.update(calendarSettings).set(settings).where(eq(calendarSettings.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(calendarSettings).values({ ...settings, storeId }).returning();
      return created;
    }
  }

  // Cash Drawer Sessions
  async getCashDrawerSessions(storeId: number): Promise<CashDrawerSessionWithActions[]> {
    const result = await db.query.cashDrawerSessions.findMany({
      where: eq(cashDrawerSessions.storeId, storeId),
      with: { actions: true },
      orderBy: (sessions, { desc }) => [desc(sessions.openedAt)],
    });
    return result as any;
  }

  async getCashDrawerSession(id: number): Promise<CashDrawerSessionWithActions | undefined> {
    const result = await db.query.cashDrawerSessions.findFirst({
      where: eq(cashDrawerSessions.id, id),
      with: { actions: true },
    });
    return result as any;
  }

  async getOpenCashDrawerSession(storeId: number): Promise<CashDrawerSessionWithActions | undefined> {
    const result = await db.query.cashDrawerSessions.findFirst({
      where: and(eq(cashDrawerSessions.storeId, storeId), eq(cashDrawerSessions.status, "open")),
      with: { actions: true },
    });
    return result as any;
  }

  async createCashDrawerSession(session: InsertCashDrawerSession): Promise<CashDrawerSession> {
    const [result] = await db.insert(cashDrawerSessions).values(session).returning();
    return result;
  }

  async updateCashDrawerSession(id: number, data: Partial<InsertCashDrawerSession>): Promise<CashDrawerSession | undefined> {
    const [result] = await db.update(cashDrawerSessions).set(data).where(eq(cashDrawerSessions.id, id)).returning();
    return result;
  }

  async createDrawerAction(action: InsertDrawerAction): Promise<DrawerAction> {
    const [result] = await db.insert(drawerActions).values(action).returning();
    return result;
  }

  async getDrawerActions(sessionId: number): Promise<DrawerAction[]> {
    return await db.select().from(drawerActions).where(eq(drawerActions.sessionId, sessionId));
  }

  async getSmsSettings(storeId: number): Promise<SmsSettings | undefined> {
    const result = await db.select().from(smsSettings).where(eq(smsSettings.storeId, storeId));
    return result[0];
  }

  async upsertSmsSettings(storeId: number, settings: Partial<InsertSmsSettings>): Promise<SmsSettings> {
    const existing = await this.getSmsSettings(storeId);
    if (existing) {
      const [result] = await db.update(smsSettings).set(settings).where(eq(smsSettings.storeId, storeId)).returning();
      return result;
    }
    const [result] = await db.insert(smsSettings).values({ ...settings, storeId }).returning();
    return result;
  }

  async getMailSettings(storeId: number): Promise<MailSettings | undefined> {
    const result = await db.select().from(mailSettings).where(eq(mailSettings.storeId, storeId));
    return result[0];
  }

  async upsertMailSettings(storeId: number, settings: Partial<InsertMailSettings>): Promise<MailSettings> {
    const existing = await this.getMailSettings(storeId);
    if (existing) {
      const [result] = await db.update(mailSettings).set(settings).where(eq(mailSettings.storeId, storeId)).returning();
      return result;
    }
    const [result] = await db.insert(mailSettings).values({ ...settings, storeId }).returning();
    return result;
  }

  async getStripeSettings(storeId: number): Promise<StripeSettings | undefined> {
    const result = await db.select().from(stripeSettings).where(eq(stripeSettings.storeId, storeId));
    return result[0];
  }

  async upsertStripeSettings(storeId: number, settings: Partial<InsertStripeSettings>): Promise<StripeSettings> {
    const existing = await this.getStripeSettings(storeId);
    if (existing) {
      const [result] = await db.update(stripeSettings).set(settings).where(eq(stripeSettings.storeId, storeId)).returning();
      return result;
    }
    const [result] = await db.insert(stripeSettings).values({ ...settings, storeId }).returning();
    return result;
  }

  async createSmsLog(log: InsertSmsLog): Promise<SmsLogEntry> {
    const [result] = await db.insert(smsLog).values(log).returning();
    return result;
  }

  async getSmsLogs(storeId: number, limit = 50): Promise<SmsLogEntry[]> {
    return await db.select().from(smsLog)
      .where(eq(smsLog.storeId, storeId))
      .orderBy(desc(smsLog.sentAt))
      .limit(limit);
  }

  async getAppointmentsNeedingReminders(fromTime: Date, toTime: Date): Promise<AppointmentWithDetails[]> {
    const result = await db.query.appointments.findMany({
      where: and(
        gte(appointments.date, fromTime),
        lte(appointments.date, toTime),
      ),
      with: {
        service: true,
        staff: true,
        customer: true,
        store: true,
      },
    });
    const activeStatuses = ["pending", "confirmed"];
    return (result as AppointmentWithDetails[]).filter(a => activeStatuses.includes(a.status || ""));
  }

  async getRecentlyCompletedAppointments(fromTime: Date, toTime: Date): Promise<AppointmentWithDetails[]> {
    const result = await db.query.appointments.findMany({
      where: and(
        isNotNull(appointments.completedAt),
        gte(appointments.completedAt, fromTime),
        lte(appointments.completedAt, toTime),
        eq(appointments.status, "completed")
      ),
      with: {
        service: true,
        staff: true,
        customer: true,
        store: true,
      },
    });
    return result as AppointmentWithDetails[];
  }

  async getSmsLogByAppointmentAndType(appointmentId: number, messageType: string): Promise<SmsLogEntry | undefined> {
    const result = await db.select().from(smsLog)
      .where(and(
        eq(smsLog.appointmentId, appointmentId),
        eq(smsLog.messageType, messageType)
      ));
    return result[0];
  }

  // User Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async findUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async createUser(user: UpsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: string, user: Partial<UpsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(user).where(eq(users.id, id)).returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
