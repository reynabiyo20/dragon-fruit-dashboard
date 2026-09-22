/**
 * LocationSelect — a cascading Province → Municipality picker.
 *
 * Province is required; municipality is optional (a province alone is enough).
 * Selecting a Province reveals only that province's municipalities; the
 * Municipality select is disabled until a province is chosen and is cleared
 * automatically whenever the province changes (so a stale municipality can't
 * survive a province switch). Both fields are controlled by the parent form via
 * `value`/`onChange`, mirroring how CustomerForm drives its other selects.
 */
import { SelectField } from './FormField';
import {
  PROVINCE_OPTIONS, municipalityOptions, COUNTRY_OPTIONS, PHILIPPINES, countryOf, isInternationalLocation,
} from '../../constants/geography';
import type { Location } from '../../types';

interface LocationSelectProps {
  value: Location;
  onChange: (next: Location) => void;
  required?: boolean;
  provinceError?: string;
  municipalityError?: string;
}

/**
 * LocationSelect — Country, then (for the Philippines only) a cascading
 * Province → Municipality picker.
 *
 * Choosing a non-Philippine country marks the record international and clears
 * the Philippine-only province/municipality. Province is required for local
 * (Philippine) records; municipality stays optional.
 */
export function LocationSelect({
  value,
  onChange,
  required,
  provinceError,
  municipalityError,
}: LocationSelectProps) {
  const country = countryOf(value);
  const international = isInternationalLocation(value);
  const municipalities = municipalityOptions(value.province);

  return (
    <div className="space-y-3">
      <SelectField
        label="Country"
        required={required}
        options={COUNTRY_OPTIONS}
        value={country}
        onChange={(e) => {
          const nextCountry = e.target.value;
          // Switching to an international country drops the PH-only fields;
          // switching back to the Philippines just restores the empty picker.
          if (nextCountry === PHILIPPINES) {
            onChange({ country: nextCountry, province: value.province, municipality: value.municipality });
          } else {
            onChange({ country: nextCountry, province: '', municipality: '' });
          }
        }}
        hint={international ? 'International — sales & expenses are recorded in USD ($).' : undefined}
      />

      {/* Province + Municipality apply to Philippine records only. */}
      {!international && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="Province"
            required={required}
            placeholder="Select province…"
            options={PROVINCE_OPTIONS}
            error={provinceError}
            value={value.province}
            onChange={(e) => {
              // Changing province invalidates any previously chosen municipality.
              onChange({ country, province: e.target.value, municipality: '' });
            }}
          />
          <SelectField
            label="Municipality"
            hint="Optional"
            placeholder={value.province ? 'Select municipality…' : 'Select a province first'}
            options={municipalities}
            disabled={!value.province}
            error={municipalityError}
            value={value.municipality}
            onChange={(e) => onChange({ ...value, country, municipality: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
