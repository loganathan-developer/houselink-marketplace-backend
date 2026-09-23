import type { Request, Response } from "express";
import { listCategoryAttributes } from "./attribute.service.js";

export const categoryAttributes = () => async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listCategoryAttributes(res.locals.validated.params.categoryId) });
};
