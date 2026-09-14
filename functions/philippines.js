import { handlePhilippines } from '../worker/src/philippines.js';

export const onRequest = ({ request, waitUntil }) => handlePhilippines(request, { waitUntil });
