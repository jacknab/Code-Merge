import { Router, type IRouter } from "express";
import templatesRouter from "./templates";
import websitesRouter from "./websites";
import subdomainsRouter from "./subdomains";
import dashboardRouter from "./dashboard";
import imageLibraryRouter from "./imageLibrary";

const router: IRouter = Router();

router.use(templatesRouter);
router.use(subdomainsRouter);
router.use(websitesRouter);
router.use(dashboardRouter);
router.use(imageLibraryRouter);

export default router;
