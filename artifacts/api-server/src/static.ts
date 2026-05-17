import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";

const BASE_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");

interface PageSeo { title: string; description: string; canonical: string; }

const SEO_CONFIG: Record<string, PageSeo> = {
  "/industries": { title: "Booking Software for Every Service Industry | Certxa", description: "Certxa works for barbers, spas, HVAC, plumbers, dog walkers, tutors, and 20+ more industries. One platform — every service business.", canonical: `${BASE_URL}/industries` },
  "/barbers": { title: "Barber Shop Booking Software — Online Appointments & POS | Certxa", description: "Let clients book barber appointments 24/7. Manage walk-ins, track chair revenue, and send automatic SMS reminders. Free 60-day trial.", canonical: `${BASE_URL}/barbers` },
  "/spa": { title: "Day Spa & Wellness Booking Software — Memberships & Gift Cards | Certxa", description: "Booking, memberships, gift cards, and therapist scheduling for day spas and wellness centers. Replace Mindbody for a fraction of the cost.", canonical: `${BASE_URL}/spa` },
  "/nails": { title: "Nail Salon Booking Software — Online Scheduling & POS | Certxa", description: "Online booking, service menus, and automatic reminders built for nail salons. Reduce no-shows and fill your appointment book every day.", canonical: `${BASE_URL}/nails` },
  "/tattoo": { title: "Tattoo Studio Booking Software — Deposits & Appointments | Certxa", description: "Manage tattoo consultations, deposits, and artist schedules in one place. Automated SMS reminders reduce costly no-shows.", canonical: `${BASE_URL}/tattoo` },
  "/haircuts": { title: "Walk-In Haircut & Barbershop Queue Management | Certxa", description: "Digital check-in, live queue display, and wait-time estimates for walk-in haircut businesses. Keep clients informed and reduce lobby crowding.", canonical: `${BASE_URL}/haircuts` },
  "/hair-salons": { title: "Hair Salon Booking Software — Stylists, Color & Cuts | Certxa", description: "Online booking for hair salons — manage stylists, color appointments, and retail products. Automatic reminders cut no-shows by up to 60%.", canonical: `${BASE_URL}/hair-salons` },
  "/groomers": { title: "Pet Grooming Booking Software — Dog & Cat Appointments | Certxa", description: "Online scheduling, pet profiles, and automated reminders for pet groomers. Manage multiple groomers and track grooming history per pet.", canonical: `${BASE_URL}/groomers` },
  "/estheticians": { title: "Esthetician Booking Software — Skin Care & Facials | Certxa", description: "Booking software built for estheticians and skin care professionals. Manage facials, waxing, and lash appointments with intake forms and reminders.", canonical: `${BASE_URL}/estheticians` },
  "/house-cleaning": { title: "House Cleaning Scheduling Software — Jobs & Invoices | Certxa", description: "Schedule recurring house cleaning jobs, dispatch crews, and send invoices automatically. Built for solo cleaners and multi-crew cleaning businesses.", canonical: `${BASE_URL}/house-cleaning` },
  "/handyman": { title: "Handyman Scheduling Software — Jobs, Estimates & Invoices | Certxa", description: "Manage handyman jobs, estimates, and invoices from your phone. Schedule crews, track job status, and get paid faster with Certxa.", canonical: `${BASE_URL}/handyman` },
  "/ride-service": { title: "Ride Service Booking Software — Dispatch & Scheduling | Certxa", description: "Online booking and dispatch for private ride services, chauffeurs, and transportation businesses. Manage drivers, routes, and payments in one place.", canonical: `${BASE_URL}/ride-service` },
  "/snow-removal": { title: "Snow Removal Scheduling Software — Routes & Crews | Certxa", description: "Schedule snow removal routes, dispatch crews, and invoice clients automatically. Built for snow plowing and ice management businesses.", canonical: `${BASE_URL}/snow-removal` },
  "/lawn-care": { title: "Lawn Care Scheduling Software — Routes, Crews & Invoices | Certxa", description: "Schedule lawn mowing routes, dispatch crews, and collect recurring payments. Built for solo lawn care operators and multi-crew landscaping businesses.", canonical: `${BASE_URL}/lawn-care` },
  "/tutoring": { title: "Tutoring Booking Software — Sessions, Scheduling & Payments | Certxa", description: "Let students book tutoring sessions online. Manage subjects, tutor availability, and payments automatically. Free 60-day trial.", canonical: `${BASE_URL}/tutoring` },
  "/dog-walking": { title: "Dog Walking Booking Software — Scheduling & GPS Tracking | Certxa", description: "Online booking, walker scheduling, and automated updates for dog walking businesses. Clients can book and pay from any device.", canonical: `${BASE_URL}/dog-walking` },
  "/hvac": { title: "HVAC Scheduling Software — Jobs, Dispatching & Invoices | Certxa", description: "Schedule HVAC service calls, dispatch technicians, and collect payments on-site. Built for HVAC contractors of all sizes.", canonical: `${BASE_URL}/hvac` },
  "/plumbing": { title: "Plumbing Scheduling Software — Jobs, Crews & Invoices | Certxa", description: "Manage plumbing service calls, dispatch plumbers, and send invoices from your phone. Built for plumbing contractors.", canonical: `${BASE_URL}/plumbing` },
  "/electrical": { title: "Electrical Contractor Scheduling Software — Jobs & Invoices | Certxa", description: "Schedule electrical jobs, manage permits, dispatch electricians, and invoice clients. Built for electrical contractors and small crews.", canonical: `${BASE_URL}/electrical` },
  "/carpet-cleaning": { title: "Carpet Cleaning Scheduling Software — Jobs & Invoices | Certxa", description: "Book carpet cleaning jobs online, dispatch crews, and send invoices automatically. Built for carpet and upholstery cleaning businesses.", canonical: `${BASE_URL}/carpet-cleaning` },
  "/pressure-washing": { title: "Pressure Washing Scheduling Software — Jobs & Invoices | Certxa", description: "Manage pressure washing jobs, dispatch crews, and collect payments fast. Online booking lets customers request quotes 24/7.", canonical: `${BASE_URL}/pressure-washing` },
  "/window-cleaning": { title: "Window Cleaning Scheduling Software — Routes & Invoices | Certxa", description: "Schedule window cleaning routes, manage recurring clients, and invoice automatically. Built for residential and commercial window cleaners.", canonical: `${BASE_URL}/window-cleaning` },
};

const SSR_ROUTES = new Set(Object.keys(SEO_CONFIG));

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const ssrBundlePath = path.resolve(__dirname, "server/entry-server.cjs");
  const indexHtmlPath = path.resolve(distPath, "index.html");
  let ssrRender: ((url: string) => { html: string }) | null = null;
  let indexTemplate: string | null = null;

  if (fs.existsSync(ssrBundlePath) && fs.existsSync(indexHtmlPath)) {
    try {
      ssrRender = require(ssrBundlePath).render;
      indexTemplate = fs.readFileSync(indexHtmlPath, "utf-8");
      console.log("[SSR] Bundle loaded — landing pages will be server-rendered");
    } catch (err) {
      console.warn("[SSR] Failed to load bundle, falling back to SPA:", err);
    }
  } else {
    console.log("[SSR] Bundle not found at", ssrBundlePath, "— serving SPA only");
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (/\.[a-f0-9]{8}\.|assets\/.*\/.+\.[a-f0-9]{8}\./.test(req.path)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (/\.(svg|png|jpg|jpeg|webp|ico)$/.test(req.path)) {
      res.setHeader("Cache-Control", "public, max-age=2592000");
    } else if (/\.(css|js)$/.test(req.path)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    } else if (/\.(woff|woff2|ttf|eot)$/.test(req.path)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (/\.html$/.test(req.path) || req.path === "/") {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.setHeader("ETag", `"${Date.now()}"`);
    }
    next();
  });

  app.use(express.static(distPath, {
    maxAge: "1h",
    dotfiles: "deny",
  }));

  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(path.resolve(distPath, "robots.txt"));
  });

  app.get("/sitemap.xml", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const today = new Date().toISOString().split("T")[0];
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0">
    <url>
        <loc>${BASE_URL}/</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${BASE_URL}/pricing</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.9</priority>
    </url>
    <url>
        <loc>${BASE_URL}/auth</loc>
        <lastmod>${today}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
</urlset>`;
    res.send(sitemap);
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqPath = req.url.split("?")[0];
    if (reqPath.startsWith("/api/") || reqPath === "/ws" || reqPath.startsWith("/ws/")) {
      return next();
    }
    if (!SSR_ROUTES.has(reqPath)) return next();
    if (!ssrRender || !indexTemplate) return next();

    try {
      const { html: appHtml } = ssrRender(req.url);
      let rendered = indexTemplate;
      if (indexTemplate.includes("<!--ssr-outlet-->")) {
        rendered = indexTemplate.replace("<!--ssr-outlet-->", appHtml);
      } else {
        rendered = indexTemplate.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
      }
      const seo = SEO_CONFIG[reqPath];
      if (seo) {
        rendered = rendered.replace(/<title>[^<]*<\/title>/, `<title>${seo.title}</title>`);
        rendered = rendered.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${seo.description}$2`);
        rendered = rendered.replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, `$1${seo.title}$2`);
        rendered = rendered.replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, `$1${seo.description}$2`);
        rendered = rendered.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${seo.canonical}$2`);
        rendered = rendered.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/i, `$1${seo.canonical}$2`);
      }
      res
        .status(200)
        .set({ "Content-Type": "text/html", "Cache-Control": "no-cache" })
        .end(rendered);
    } catch (err) {
      console.warn(`[SSR] Render failed for ${reqPath}, falling back to SPA:`, err);
      next();
    }
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqPath = req.url.split("?")[0];
    if (
      reqPath.startsWith("/api/") ||
      reqPath === "/ws" ||
      reqPath.startsWith("/ws/")
    ) {
      return next();
    }
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.sendFile(indexHtmlPath, (err) => {
      if (err) {
        console.error("[static] Failed to serve index.html:", err);
        if (!res.headersSent) {
          res.status(500).send("Server error: could not load the application.");
        }
      }
    });
  });
}
