// Vercel discovers Node backends from a root server entry point. The actual
// application remains in server/index.js so `npm start` keeps working locally
// and on Railway/Render.
import express from 'express';
import app from './server/index.js';

// Keep the framework import explicit: Vercel uses it while detecting Express
// applications. The app itself is constructed in server/index.js.
void express;

export default app;
