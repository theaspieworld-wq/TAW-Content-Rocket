import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import outrosRouter from "./outros";
import brandsRouter from "./brands";

const router: IRouter = Router();

router.use(healthRouter);
router.use(jobsRouter);
router.use(outrosRouter);
router.use(brandsRouter);

export default router;
