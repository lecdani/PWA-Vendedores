/**
 * Validación de fortaleza de contraseña (misma lógica que Sistema Web Admin).
 * Requisitos: 8 caracteres, mayúscula, minúscula, número, carácter especial.
 */
export interface PasswordStrengthResult {
  isValid: boolean;
  score: number;
  feedback: string[];
}

const SPECIAL_CHARS = /[!@#$%^&*(),.?":{}|<>\-]/;

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];
  let score = 0;

  if (!password) {
    return {
      isValid: false,
      score: 0,
      feedback: ['La contraseña es requerida'],
    };
  }

  if (password.length >= 8) {
    score++;
  } else {
    feedback.push('Mínimo 8 caracteres');
  }

  if (/[A-Z]/.test(password)) {
    score++;
  } else {
    feedback.push('Al menos una mayúscula');
  }

  if (/[a-z]/.test(password)) {
    score++;
  } else {
    feedback.push('Al menos una minúscula');
  }

  if (/\d/.test(password)) {
    score++;
  } else {
    feedback.push('Al menos un número');
  }

  if (SPECIAL_CHARS.test(password)) {
    score++;
  } else {
    feedback.push('Al menos un carácter especial (!@#$% etc.)');
  }

  if (password.length > 128) {
    feedback.push('La contraseña no puede exceder 128 caracteres');
  }

  const isValid = feedback.length === 0;
  return {
    isValid,
    score: Math.min(5, score),
    feedback,
  };
}

/** Texto de requisitos para mostrar al usuario (UX) */
export const PASSWORD_REQUIREMENTS_LABEL = 'La contraseña debe tener:';

export const PASSWORD_REQUIREMENTS = [
  'Mínimo 8 caracteres',
  'Al menos una letra mayúscula',
  'Al menos una letra minúscula',
  'Al menos un número',
  'Al menos un carácter especial (!@#$%^&* etc.)',
] as const;
