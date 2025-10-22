import express from "express";

import { authMiddleWare } from "../middlewares/authMiddleware";
import { confirmBedash, createBedash, getBedashList } from "../controllers/bedashController";


const router = express.Router();

router.post("/add", authMiddleWare, createBedash);
router.get("/all", authMiddleWare, getBedashList);
;
router.put("/complete/:id", authMiddleWare, confirmBedash);

export default router;
