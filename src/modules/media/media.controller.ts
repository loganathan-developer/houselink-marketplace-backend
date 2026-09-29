import type { Request, Response } from "express";
import { createMedia, deleteMedia } from "./media.service.js";

export async function upload(req: Request, res: Response) {
  const media = await createMedia(req.file, res.locals.validated.body.purpose, req.auth!.userId);
  res.status(201).json({ success: true, data: { media } });
}

export async function remove(_req: Request, res: Response) {
  await deleteMedia(res.locals.validated.params.mediaId);
  res.status(204).send();
}
