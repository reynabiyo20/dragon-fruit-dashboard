import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

interface BaseProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

/* ── Text / Number / Date Input ─────────────────────────────────────────────── */

interface InputFieldProps extends BaseProps, InputHTMLAttributes<HTMLInputElement> {
  type?: string;
}

export function InputField({ label, error, hint, required, className = '', ...rest }: InputFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        {...rest}
        className={[
          'px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition',
          error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white',
          'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
          className,
        ].join(' ')}
      />
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

/* ── Select ──────────────────────────────────────────────────────────────────── */

interface SelectFieldProps extends BaseProps, SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectField({ label, error, hint, required, options, placeholder, className = '', ...rest }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        {...rest}
        className={[
          'px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition bg-white',
          error ? 'border-red-400 bg-red-50' : 'border-gray-300',
          'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
          className,
        ].join(' ')}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

/* ── Textarea ────────────────────────────────────────────────────────────────── */

interface TextareaFieldProps extends BaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function TextareaField({ label, error, hint, required, className = '', ...rest }: TextareaFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <textarea
        rows={3}
        {...rest}
        className={[
          'px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-y',
          error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white',
          'disabled:bg-gray-50 disabled:text-gray-400',
          className,
        ].join(' ')}
      />
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

/* ── Checkbox ────────────────────────────────────────────────────────────────── */

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function CheckboxField({ label, checked, onChange, hint }: CheckboxFieldProps) {
  return (
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        id={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
      />
      <div>
        <label htmlFor={label} className="text-sm font-medium text-gray-700 cursor-pointer">{label}</label>
        {hint && <p className="text-xs text-gray-400">{hint}</p>}
      </div>
    </div>
  );
}

/* ── Read-only display field ─────────────────────────────────────────────────── */

interface DisplayFieldProps {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}

export function DisplayField({ label, value, highlight = false }: DisplayFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-500">{label}</label>
      <div className={`px-3 py-2 text-sm border rounded-lg bg-gray-50 ${highlight ? 'font-semibold text-green-700 border-green-200' : 'text-gray-700 border-gray-200'}`}>
        {value}
      </div>
    </div>
  );
}
