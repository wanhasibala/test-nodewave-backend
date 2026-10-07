import jwt from 'jsonwebtoken';
import { Department, UserRole } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  department: Department;
}

const JWT_SECRET = process.env.JWT_SECRET || 'nodewave-super-secret-jwt-key-2026-production';
const JWT_EXPIRES_IN = '7d';

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};
