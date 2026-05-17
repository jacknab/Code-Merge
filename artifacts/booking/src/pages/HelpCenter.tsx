import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Calendar,
  Users,
  Scissors,
  ShoppingBag,
  Globe,
  CreditCard,
  BarChart3,
  MessageSquare,
  Star,
  Clock,
  HelpCircle,
  BookOpen,
  Zap,
  Settings,
  UserCircle,
  Banknote,
  Bell,
  Shield,
  ListOrdered,
  Megaphone,
  FileText,
  Mail,
  MapPin,
  ClipboardList,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Article = {
  question: string;
  answer: string | ReactNode;
};

type Section = {
  id: string;
  icon: typeof LayoutDashboard;
  title: string;
  color: string;
  description: string;
  articles: Article[];
};

const sections: Section[] = [
  {
    id: "getting-started",
    icon: Zap,
    title: "Getting Started",
    color: "text-amber-600",
    description: "Set up your account and get running in minutes.",
    articles: [
      {
        question: "How do I set up my business for the first time?",
        answer:
          "After registering, go to Business Settings to enter your business name, address, hours, and contact details. Then add your Services, followed by your Team members. Finally, configure your Online Booking page so clients can start booking you right away.",
      },
      {
        question: "How do I invite staff members?",
        answer:
          "Go to Team in the sidebar. Click Invite Staff and enter their email address. They'll receive an invitation email with a link to set up their password. You can assign them a role (Owner, Manager, Staff) and configure their permissions under Roles & Permissions.",
      },
      {
        question: "What's the difference between Owner, Manager, and Staff roles?",
        answer:
          "Owner has full access to everything including billing and business settings. Manager can manage appointments, clients, services, and staff but cannot access billing. Staff can only view and manage their own appointments and assigned clients, depending on the permissions you configure.",
      },
      {
        question: "How do I set my business hours?",
        answer:
          "Go to Business Settings → Hours. Set your open/close times for each day of the week. Toggle days off for days you're closed. These hours control when clients can book online and when the calendar shows available slots.",
      },
      {
        question: "Can I use Certxa on mobile?",
        answer:
          "Yes. The dashboard is fully mobile-responsive and works in any modern browser on iOS or Android. For the best experience add it to your home screen: on iOS tap Share → Add to Home Screen; on Android tap the browser menu → Add to Home Screen.",
      },
    ],
  },
  {
    id: "calendar",
    icon: Calendar,
    title: "Calendar & Appointments",
    color: "text-blue-600",
    description: "Manage your schedule, book appointments, and handle your calendar.",
    articles: [
      {
        question: "How do I create a new appointment?",
        answer:
          "Click any empty time slot on the Calendar, or click the + New button. Select the client (or create one on the spot), choose the service, assign a staff member, confirm the date and time, and click Save. The client will automatically receive a confirmation notification if SMS/email notifications are enabled.",
      },
      {
        question: "How do I reschedule or edit an appointment?",
        answer:
          "Click the appointment on the calendar to open it. Click Edit, change the date, time, service, or staff member, then Save. The client will receive an automatic reschedule notification if enabled.",
      },
      {
        question: "How do I cancel an appointment?",
        answer:
          "Open the appointment and click Cancel Appointment. You can optionally send a cancellation message to the client. Cancelled appointments are tracked in Reports so you can monitor your cancellation rate.",
      },
      {
        question: "What are buffer times and how do I use them?",
        answer:
          "Buffer times add automatic gaps between appointments — for example 15 minutes of cleanup time after every haircut. Set them per service under Services → Edit Service → Buffer Time. The calendar will block that time after the appointment automatically.",
      },
      {
        question: "Can I block off time on the calendar?",
        answer:
          "Yes. Click any time slot and choose Block Time. Add a label like 'Lunch' or 'Staff Meeting', set the duration, and save. Blocked time won't be available for online bookings.",
      },
      {
        question: "How do I set staff schedules and time off?",
        answer:
          "Go to Team → click a staff member → Schedule. Set their working hours per day. For time off, go to Calendar Settings → Time Off and add dates. The staff member won't be bookable during those times.",
      },
      {
        question: "How does the color coding on the calendar work?",
        answer:
          "Each appointment is color-coded by status: Green = Confirmed, Yellow = Pending, Blue = Checked In, Gray = Completed, Red = Cancelled. You can also assign custom colors to individual staff members in their profile.",
      },
      {
        question: "Can I view multiple staff members' schedules at once?",
        answer:
          "Yes. The calendar has a multi-staff view. Use the staff filter at the top of the calendar to select which team members to display. Each staff member gets their own column.",
      },
    ],
  },
  {
    id: "clients",
    icon: Users,
    title: "Clients & CRM",
    color: "text-green-600",
    description: "Manage your client database, history, and relationships.",
    articles: [
      {
        question: "How do I add a new client?",
        answer:
          "Go to Customers and click Add Client. Enter their name, phone number, email, and any notes. You can also create clients on the fly when booking an appointment — just type their name and choose Create New Client.",
      },
      {
        question: "What information is stored in a client profile?",
        answer:
          "Each client profile includes: contact details, appointment history, total spend, visit frequency, notes, intake form responses, loyalty points balance, SMS conversation history, and any photos or files you attach. It's your complete record for that client.",
      },
      {
        question: "How do I add notes to a client?",
        answer:
          "Open the client's profile and click the Notes tab. Add private notes visible only to staff — things like service preferences, allergies, or special instructions. Notes are date-stamped and attributed to the staff member who wrote them.",
      },
      {
        question: "How does the Waitlist work?",
        answer:
          "The Waitlist lets clients join a queue for a specific service or time slot when you're fully booked. Go to Waitlist in the sidebar to see who's waiting. When a slot opens, click Notify to send them an SMS or email to book. Clients can also join the waitlist themselves through your online booking page.",
      },
      {
        question: "How does the Queue / Walk-in Check-in work?",
        answer:
          "The Queue is a real-time walk-in management system. Clients scan a QR code or visit your check-in URL to add themselves. You'll see their name appear in the Queue dashboard with their wait time. Use this for walk-in businesses or as a front-desk check-in tool.",
      },
      {
        question: "How do I merge duplicate clients?",
        answer:
          "Open one of the duplicate client profiles. Click the Actions menu and select Merge Client. Search for the duplicate and confirm. All appointment history, notes, and loyalty points will be combined into one profile.",
      },
      {
        question: "Can clients fill out intake forms before their appointment?",
        answer:
          "Yes. Create intake forms under Business → Intake Forms. Attach them to specific services. When a client books that service online, they'll be prompted to complete the form. Responses appear on the appointment and in their client profile.",
      },
    ],
  },
  {
    id: "services",
    icon: Scissors,
    title: "Services & Pricing",
    color: "text-purple-600",
    description: "Set up the services you offer, pricing, and duration.",
    articles: [
      {
        question: "How do I add a new service?",
        answer:
          "Go to Business → Services and click Add Service. Enter the service name, category, duration, price, and which staff members can perform it. You can also add a description that appears on your online booking page.",
      },
      {
        question: "Can I offer services at different prices for different staff?",
        answer:
          "Yes. When editing a service, you can set a price override per staff member. For example, a senior stylist might charge more than a junior — set their individual price in the service's Staff Pricing section.",
      },
      {
        question: "What are add-ons?",
        answer:
          "Add-ons are optional extras clients can add to a service when booking — like a deep conditioning treatment with a haircut. Create them under Business → Add-ons and attach them to the relevant services. They appear as checkboxes on your online booking page.",
      },
      {
        question: "How do I create service categories?",
        answer:
          "When adding or editing a service, type a new category name in the Category field or select an existing one. Categories group your services on the online booking page making it easier for clients to find what they want.",
      },
      {
        question: "Can I hide a service from online booking but keep it for internal use?",
        answer:
          "Yes. Edit the service and toggle Off the Online Booking switch. It will still appear when staff create appointments internally but won't be visible to clients booking online.",
      },
      {
        question: "How do I set up packages or memberships?",
        answer:
          "Packages and memberships are managed through the Loyalty Program and billing features. Contact support for custom package configuration if your needs are more complex.",
      },
    ],
  },
  {
    id: "online-booking",
    icon: Globe,
    title: "Online Booking",
    color: "text-sky-600",
    description: "Let clients book themselves 24/7 through your booking page.",
    articles: [
      {
        question: "How do I set up my online booking page?",
        answer:
          "Go to Settings → Online Booking. Enable the toggle at the top, then configure your booking URL slug (e.g. certxa.com/book/your-business), choose which services and staff to show, set advance booking limits, and customize your cancellation policy. Click Save and your booking page is live.",
      },
      {
        question: "Where do clients go to book online?",
        answer:
          "Your booking page URL is shown in Settings → Online Booking. It follows the format: certxa.com/book/your-slug. Share this link on your website, Instagram bio, Google Business profile, and anywhere else clients find you.",
      },
      {
        question: "Can I require a deposit for online bookings?",
        answer:
          "Yes. In Settings → Online Booking, enable Require Deposit and set the amount (fixed dollar amount or percentage). Clients will need to pay the deposit via card when they book. The deposit is credited toward their total at checkout.",
      },
      {
        question: "How do I limit how far in advance clients can book?",
        answer:
          "In Settings → Online Booking, set the Booking Window. For example, set it to 60 days so clients can only book up to 60 days in advance. You can also set a minimum notice period — e.g. clients must book at least 2 hours before the appointment.",
      },
      {
        question: "Can clients cancel or reschedule online?",
        answer:
          "Yes, if you allow it. In Settings → Online Booking, toggle on Allow Online Cancellations and set a cancellation policy window (e.g. must cancel at least 24 hours before). Clients get a link in their confirmation email to manage their appointment.",
      },
      {
        question: "How do I embed the booking widget on my website?",
        answer:
          "In Settings → Online Booking, scroll to the Embed section. Copy the iframe code or the booking button code and paste it into your website's HTML. Clients can book directly without leaving your site.",
      },
      {
        question: "What confirmation does the client receive after booking?",
        answer:
          "Clients receive an email and/or SMS confirmation (depending on your notification settings) with the appointment details, date, time, service, and staff member. The message includes a link to reschedule or cancel if you've enabled that option.",
      },
      {
        question: "How do automated reminders work?",
        answer:
          "Go to Settings → SMS Notifications or Email Notifications. Enable appointment reminders and set the timing — e.g. send a reminder 24 hours before and again 2 hours before. Reminders are sent automatically with no action needed from you or your staff.",
      },
      {
        question: "Can I take payments through the online booking page?",
        answer:
          "Yes. Connect your Stripe account in Business Settings → Payments. Once connected, you can require deposits at booking or charge a no-show fee. Full payment collection at booking is also available.",
      },
    ],
  },
  {
    id: "pos",
    icon: CreditCard,
    title: "Point of Sale & Payments",
    color: "text-emerald-600",
    description: "Check out clients, process payments, and sell products.",
    articles: [
      {
        question: "How do I check out a client after their appointment?",
        answer:
          "From the Calendar, click the completed appointment and select Checkout. Or go to the POS from the sidebar. The services from the appointment are pre-loaded. Add any retail products sold, apply discounts or loyalty points, then select the payment method and complete the sale.",
      },
      {
        question: "What payment methods can I accept?",
        answer:
          "Cash, card (via Stripe), and gift cards. If you use a Stripe card reader you can accept tap, chip, and swipe payments in person. You can split payments across multiple methods — e.g. part cash, part card.",
      },
      {
        question: "How do I apply a discount at checkout?",
        answer:
          "On the checkout screen, click Add Discount. Enter a percentage or fixed dollar amount. You can also create saved discount codes under Business Settings → Discounts for staff to apply by code.",
      },
      {
        question: "How do gift cards work?",
        answer:
          "Go to Gift Cards in the sidebar to issue and manage gift cards. Enter a value and generate a code. The code can be redeemed at checkout by entering it in the Gift Card field. The balance is tracked automatically.",
      },
      {
        question: "How does the Cash Drawer work?",
        answer:
          "Go to Finance → Cash Drawer. Open a drawer session by entering your starting cash amount. Throughout the day, all cash transactions are recorded. At the end of day, count your drawer and close the session — it will show you any discrepancies.",
      },
      {
        question: "Can I issue refunds?",
        answer:
          "Yes. Find the completed appointment or transaction in Reports, open the receipt, and click Refund. For card payments, the refund goes back to the original card. For cash, you'll handle it manually at the drawer.",
      },
      {
        question: "How do I track product sales?",
        answer:
          "Products are added at checkout from the POS screen. Go to Business → Products to manage your retail inventory. Sales reports in Finance → Reports show product revenue broken out from service revenue.",
      },
    ],
  },
  {
    id: "loyalty",
    icon: Star,
    title: "Loyalty Program",
    color: "text-yellow-600",
    description: "Reward your best clients and keep them coming back.",
    articles: [
      {
        question: "How do I set up a loyalty program?",
        answer:
          "Go to Clients → Loyalty Program. Enable the program and configure how points are earned — e.g. 1 point per $1 spent. Set reward tiers and what clients can redeem points for (discounts, free services). Save, and points will start accumulating automatically at checkout.",
      },
      {
        question: "How do clients earn loyalty points?",
        answer:
          "Points are earned automatically when a client is checked out through the POS. The earning rate is based on your configuration (e.g. 1 point per dollar). Points appear on the client's profile and they're notified of their balance.",
      },
      {
        question: "How do clients redeem loyalty points?",
        answer:
          "At checkout, if a client has redeemable points the option will appear in the POS. Staff can apply the points discount with one click. The client's balance updates automatically.",
      },
      {
        question: "Can I manually adjust a client's points?",
        answer:
          "Yes. Open the client's profile, go to the Loyalty tab, and click Adjust Points. Add or subtract points and add a note explaining the adjustment. This is useful for correcting errors or rewarding clients for referrals.",
      },
    ],
  },
  {
    id: "marketing",
    icon: Megaphone,
    title: "Campaigns & Marketing",
    color: "text-pink-600",
    description: "Reach your clients with targeted SMS and email campaigns.",
    articles: [
      {
        question: "How do I send a marketing campaign?",
        answer:
          "Go to Clients → Campaigns and click New Campaign. Choose SMS or Email, write your message, and select your audience — all clients, specific segments (e.g. clients who haven't visited in 60 days), or a manual selection. Schedule it or send immediately.",
      },
      {
        question: "Can I segment my client list for campaigns?",
        answer:
          "Yes. When creating a campaign, use the audience filter to target clients by last visit date, total spend, service type, loyalty tier, or birthday month. This lets you send the right message to the right people.",
      },
      {
        question: "How do automated re-engagement messages work?",
        answer:
          "Under SMS Notifications, you can set up automatic re-engagement messages — for example, automatically send an SMS to any client who hasn't booked in 45 days. This runs in the background with no manual effort.",
      },
      {
        question: "How do I manage the SMS inbox?",
        answer:
          "Go to Clients → SMS Inbox. All two-way SMS conversations with clients appear here. You can reply directly to clients, and all messages are saved to their profile. You'll see unread message counts in the sidebar badge.",
      },
      {
        question: "How do I get more Google Reviews?",
        answer:
          "Go to Clients → Google Reviews. Connect your Google Business profile, then enable automatic review requests. After each completed appointment, clients automatically receive an SMS or email prompting them to leave a Google review.",
      },
    ],
  },
  {
    id: "reports",
    icon: BarChart3,
    title: "Reports & Analytics",
    color: "text-indigo-600",
    description: "Understand your business performance with detailed reporting.",
    articles: [
      {
        question: "What reports are available?",
        answer:
          "Finance → Reports includes: Sales Summary, Revenue by Service, Revenue by Staff, Product Sales, Appointment Summary, Cancellation Report, No-Show Report, and Tax Report. The Dashboard shows a real-time overview of today's activity. Analytics shows trends over time.",
      },
      {
        question: "How do I view revenue by staff member?",
        answer:
          "Go to Finance → Reports and select the Revenue by Staff report. Choose your date range. You'll see each team member's total service revenue, product sales, tip amount, and number of appointments.",
      },
      {
        question: "How do commissions work?",
        answer:
          "Go to Finance → Commissions. Set commission rates per staff member — either a flat percentage of service revenue or tiered rates based on performance. The commission report calculates each staff member's earned commission for any date range.",
      },
      {
        question: "What is Revenue Intelligence?",
        answer:
          "Revenue Intelligence (Overview → Revenue Intelligence) uses AI to analyze your booking patterns, client retention, and revenue trends. It surfaces insights like your busiest times, highest-value clients, and services with the most cancellations — helping you make smarter business decisions.",
      },
      {
        question: "How do I export reports?",
        answer:
          "On any report page, click the Export button to download a CSV or PDF. You can also print reports directly from the browser.",
      },
    ],
  },
  {
    id: "notifications",
    icon: Bell,
    title: "Notifications & Reminders",
    color: "text-orange-600",
    description: "Keep clients informed with automated SMS and email messages.",
    articles: [
      {
        question: "How do I set up SMS notifications?",
        answer:
          "Go to Settings → SMS Notifications. Enable the notifications you want — booking confirmations, reminders, cancellation notices, and review requests. Set the timing for reminders (e.g. 24 hours before). Messages are sent automatically using your Twilio number.",
      },
      {
        question: "How do I set up email notifications?",
        answer:
          "Go to Settings → Email Notifications. Toggle on the emails you want to send — booking confirmations, reminders, follow-ups. Customize the email template with your business name and branding.",
      },
      {
        question: "Can I customize the text of notification messages?",
        answer:
          "Yes. In SMS/Email Notification settings, click Edit on any message template. You can customize the text and use merge tags like {client_name}, {appointment_date}, {service_name}, and {business_name} to personalize each message.",
      },
      {
        question: "Why are my SMS notifications not sending?",
        answer:
          "Check that your Twilio credentials are saved in Business Settings → Integrations. Also verify the client has a valid mobile number in their profile. If you're in trial mode, Twilio may only send to verified numbers. Contact support if messages are still not going through.",
      },
    ],
  },
  {
    id: "website-builder",
    icon: Globe,
    title: "Website Builder",
    color: "text-teal-600",
    description: "Build a professional website for your business — no code needed.",
    articles: [
      {
        question: "How do I access the Website Builder?",
        answer:
          "Click Website Builder in the sidebar under Tools. It opens in a new tab. You can also go directly to your Certxa domain at /website-builder/.",
      },
      {
        question: "How do I create my first website?",
        answer:
          "In the Website Builder, click New Site. Choose a template that fits your business style — salon, spa, barbershop, and more. Give your site a name and click Create. The editor opens with your template ready to customize.",
      },
      {
        question: "How do I edit text on my website?",
        answer:
          "Click any text block on the canvas to select it. A text editor toolbar appears — change the font, size, color, alignment, and content. Click outside to deselect. Changes are saved automatically.",
      },
      {
        question: "How do I add or change images?",
        answer:
          "Click any image on the canvas to select it. Click Replace Image in the toolbar to upload a new photo from your device or choose from the built-in stock photo library. Drag the corners to resize.",
      },
      {
        question: "How do I add a booking button to my website?",
        answer:
          "Select any button element or add a new Button block. In the link settings, choose Booking Page and your online booking URL will be linked automatically. Visitors who click it go directly to your booking page.",
      },
      {
        question: "How do I add a new page to my website?",
        answer:
          "In the Website Builder sidebar, click Pages → Add Page. Give the page a name (e.g. 'About Us', 'Gallery', 'Pricing'). It will appear in your site's navigation automatically. Edit it the same way as any other page.",
      },
      {
        question: "How do I publish my website?",
        answer:
          "Click the Publish button in the top-right corner of the editor. Your site goes live instantly at your Certxa subdomain. To use a custom domain, go to Site Settings → Domain and enter your domain name, then follow the DNS instructions.",
      },
      {
        question: "Can I connect a custom domain to my website?",
        answer:
          "Yes. Go to Site Settings → Domain in the Website Builder. Enter your custom domain (e.g. www.yoursalon.com). You'll be shown two DNS records to add at your domain registrar (GoDaddy, Namecheap, etc.). Once DNS propagates (usually 24–48 hours), your site will be live on your custom domain.",
      },
      {
        question: "How do I add a contact form to my website?",
        answer:
          "In the block library (click the + Add Block button), find the Contact Form block. Drag it onto your page. Configure which fields to include (name, email, phone, message) and where form submissions should be sent. Submissions are emailed to your business email and logged in the Website Builder.",
      },
      {
        question: "How do I optimize my site for Google (SEO)?",
        answer:
          "In Site Settings → SEO, set your page title, meta description, and keywords for each page. Add alt text to all images. The Website Builder also auto-generates a sitemap.xml for Google to crawl. For local SEO, make sure your business name, address, and phone number are consistent across your site and Google Business profile.",
      },
      {
        question: "What templates are available?",
        answer:
          "Templates include layouts designed for salons, spas, barbershops, nail studios, tattoo studios, massage therapists, and general service businesses. Each template includes a home page, services page, gallery, and contact page — all fully customizable.",
      },
    ],
  },
  {
    id: "settings",
    icon: Settings,
    title: "Account & Settings",
    color: "text-slate-600",
    description: "Manage your account, business profile, and integrations.",
    articles: [
      {
        question: "How do I update my business information?",
        answer:
          "Go to Settings → Business Settings. Update your business name, address, phone number, email, and social media links. This information appears on your booking page and website.",
      },
      {
        question: "How do I change my password?",
        answer:
          "Go to Settings → My Account → Security. Enter your current password, then your new password twice, and save. If you've forgotten your password, log out and click Forgot Password on the login screen.",
      },
      {
        question: "How do I manage multiple locations?",
        answer:
          "Multi-location is available on the Elite plan. Go to Settings → Multi-Location to add additional business locations. Each location has its own calendar, staff, and settings. Switch between locations using the location selector at the top of the dashboard.",
      },
      {
        question: "How do I connect Stripe for payments?",
        answer:
          "Go to Settings → Business Settings → Payments and click Connect Stripe. You'll be redirected to Stripe to create or connect an account. Once connected, you can accept card payments online and in-person.",
      },
      {
        question: "How do I connect Google Calendar?",
        answer:
          "Go to Settings → Calendar Settings → Integrations and click Connect Google Calendar. Authorize access. Your Certxa appointments will sync to your Google Calendar automatically, and you can block Certxa time based on your Google Calendar events.",
      },
      {
        question: "What are API Keys used for?",
        answer:
          "API Keys (Elite plan) let you connect Certxa to external tools like Zapier, your own apps, or custom integrations. Go to Settings → API Keys to generate a key. Our API documentation is available under the API Keys page.",
      },
      {
        question: "How do I cancel or change my plan?",
        answer:
          "Go to the Account section → Billing. You'll see your current plan and billing cycle. Click Change Plan to upgrade, downgrade, or cancel. If you cancel, your account remains active until the end of the billing period.",
      },
    ],
  },
];

function ArticleAccordion({ articles }: { articles: Article[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <div className="divide-y divide-border">
      {articles.map((article, i) => (
        <div key={i}>
          <button
            className="w-full flex items-start justify-between gap-3 py-4 text-left hover:text-primary transition-colors"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            <span className="font-medium text-sm leading-snug">{article.question}</span>
            {openIndex === i
              ? <ChevronDown className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
              : <ChevronRight className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />}
          </button>
          {openIndex === i && (
            <div className="pb-4 text-sm text-muted-foreground leading-relaxed">
              {article.answer}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HelpCenter() {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const filtered = search.trim().toLowerCase();

  const matchingSections = sections
    .map((s) => ({
      ...s,
      articles: s.articles.filter(
        (a) =>
          !filtered ||
          a.question.toLowerCase().includes(filtered) ||
          (typeof a.answer === "string" && a.answer.toLowerCase().includes(filtered))
      ),
    }))
    .filter((s) => !filtered || s.articles.length > 0);

  const totalArticles = sections.reduce((n, s) => n + s.articles.length, 0);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#3B0764] to-[#6D28D9] text-white">
        <div className="max-w-4xl mx-auto px-6 py-14 text-center">
          <div className="flex justify-center mb-4">
            <BookOpen className="h-10 w-10 opacity-80" />
          </div>
          <h1
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontWeight: 700,
              fontSize: "2.4rem",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            Help Center
          </h1>
          <p className="mt-2 text-purple-200 text-base">
            Everything you need to get the most out of Certxa — {totalArticles} articles across{" "}
            {sections.length} topics.
          </p>
          <div className="mt-6 max-w-xl mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-300 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search help articles…"
              className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-purple-300 focus-visible:ring-white/30 h-11"
            />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10">
        {/* Quick links grid (only when not searching) */}
        {!filtered && !activeSection && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-10">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/30 hover:shadow-md transition-all"
              >
                <s.icon className={cn("h-5 w-5", s.color)} />
                <span className="font-semibold text-sm leading-tight">{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.articles.length} articles</span>
              </button>
            ))}
          </div>
        )}

        {/* Back button when a section is selected */}
        {activeSection && !filtered && (
          <button
            onClick={() => setActiveSection(null)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
            All Topics
          </button>
        )}

        {/* Content */}
        <div className="space-y-6">
          {matchingSections
            .filter((s) => !activeSection || s.id === activeSection)
            .map((section) => (
              <div
                key={section.id}
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                <button
                  className="w-full flex items-center gap-3 px-6 py-5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() =>
                    setActiveSection(activeSection === section.id ? null : section.id)
                  }
                >
                  <div className={cn("p-2 rounded-lg bg-muted", section.color)}>
                    <section.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{section.title}</p>
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {section.articles.length}
                  </Badge>
                  {activeSection === section.id
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>

                {(activeSection === section.id || !!filtered) && (
                  <div className="px-6 pb-2">
                    <ArticleAccordion articles={section.articles} />
                  </div>
                )}
              </div>
            ))}

          {filtered && matchingSections.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <HelpCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No articles match "{search}"</p>
              <p className="text-sm mt-1">Try different keywords or browse topics above.</p>
            </div>
          )}
        </div>

        {/* Contact footer */}
        <div className="mt-12 rounded-2xl border border-border bg-card p-8 text-center">
          <HelpCircle className="h-8 w-8 mx-auto mb-3 text-primary/60" />
          <h2 className="font-semibold text-lg mb-1">Still need help?</h2>
          <p className="text-muted-foreground text-sm mb-5">
            Can't find what you're looking for? Our support team is here for you.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <a
              href="mailto:support@certxa.com"
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Mail className="h-4 w-4" />
              Email Support
            </a>
            <a
              href="https://certxa.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Visit certxa.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
