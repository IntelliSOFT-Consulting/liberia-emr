import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineLoading,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Search,
  Select,
  SelectItem,
} from '@carbon/react';
import { type ReportingContext } from '../context/reporting-context.resource';
import { facilityAreas, filterFacilities, useFacilities } from './mfl-locations.resource';
import styles from './location-picker.scss';

export type LocationLevel = 'national' | 'county' | 'district' | 'facility';

export interface ReportLocation {
  level: LocationLevel;
  /** Absent for national only, which only central offers. */
  uuid?: string;
  name: string;
}

interface LocationPickerProps {
  context: ReportingContext;
  facilityLocationTag: string;
  mflCodeAttributeTypeUuid: string;
  maxFacilitiesShown: number;
  onChange: (location: ReportLocation) => void;
}

/**
 * Render only when `isLocationKnown(context)`.
 *
 * At a facility: the facility itself, fixed. The backend clamps to it anyway (ADR 0010 decision 5).
 * At central: national, or any county, district or facility of the MFL hierarchy. The most
 * specific choice wins, so narrowing to a county and stopping there reports on the county.
 */
const LocationPicker: React.FC<LocationPickerProps> = (props) =>
  props.context.role === 'central' ? <CentralLocationPicker {...props} /> : <FacilityLocation {...props} />;

const FacilityLocation: React.FC<LocationPickerProps> = ({ context, onChange }) => {
  const { t } = useTranslation();
  const facility = context.facilityLocation;
  const name = facility?.display || t('thisFacility', 'This facility');

  // Without its UUID nothing is reported: a run must never go out without a location here.
  useEffect(() => {
    if (facility?.uuid) {
      onChange({ level: 'facility', uuid: facility.uuid, name });
    }
  }, [facility?.uuid, name, onChange]);

  if (!facility?.uuid) {
    return null;
  }

  return (
    <div className={styles.fixedLocation} data-testid="fixed-location">
      <span className={styles.label}>{t('location', 'Location')}</span>
      <span className={styles.value}>{name}</span>
      <span className={styles.helper}>
        {t('facilityLocationFixed', 'A facility server reports on its own facility only.')}
      </span>
    </div>
  );
};

const CentralLocationPicker: React.FC<LocationPickerProps> = ({
  facilityLocationTag,
  mflCodeAttributeTypeUuid,
  maxFacilitiesShown,
  onChange,
}) => {
  const { t } = useTranslation();
  const id = useId();
  const [countyUuid, setCountyUuid] = useState('');
  const [districtUuid, setDistrictUuid] = useState('');
  const [facilityUuid, setFacilityUuid] = useState('');
  const [query, setQuery] = useState('');
  const { facilities, error, isLoading } = useFacilities(facilityLocationTag, mflCodeAttributeTypeUuid);

  const { counties, districts } = useMemo(() => facilityAreas(facilities, countyUuid), [facilities, countyUuid]);
  const matches = useMemo(
    () => filterFacilities(facilities, { query, countyUuid, districtUuid }),
    [facilities, query, countyUuid, districtUuid],
  );
  const shown = matches.slice(0, maxFacilitiesShown);

  const selection: ReportLocation = useMemo(() => {
    const facility = facilityUuid && facilities.find((f) => f.uuid === facilityUuid);
    if (facility) {
      return { level: 'facility', uuid: facility.uuid, name: facility.name };
    }
    const district = districtUuid && districts.find((d) => d.uuid === districtUuid);
    if (district) {
      return { level: 'district', uuid: district.uuid, name: district.name };
    }
    const county = countyUuid && counties.find((c) => c.uuid === countyUuid);
    if (county) {
      return { level: 'county', uuid: county.uuid, name: county.name };
    }
    return { level: 'national', name: t('national', 'National (all facilities)') };
  }, [facilityUuid, districtUuid, countyUuid, facilities, districts, counties, t]);

  // On the fields, not the object: a new object with the same choice must not re-report it.
  useEffect(
    () => onChange({ level: selection.level, uuid: selection.uuid, name: selection.name }),
    [selection.level, selection.uuid, selection.name, onChange],
  );

  return (
    <fieldset className={styles.picker}>
      <legend className={styles.label}>{t('location', 'Location')}</legend>
      <div className={styles.areas}>
        <Select
          id={`${id}-county`}
          labelText={t('county', 'County')}
          value={countyUuid}
          onChange={(event) => {
            setCountyUuid(event.target.value);
            setDistrictUuid('');
            setFacilityUuid('');
          }}
        >
          <SelectItem value="" text={t('national', 'National (all facilities)')} />
          {counties.map((county) => (
            <SelectItem key={county.uuid} value={county.uuid} text={county.name} />
          ))}
        </Select>
        <Select
          id={`${id}-district`}
          labelText={t('district', 'District')}
          value={districtUuid}
          disabled={!countyUuid}
          onChange={(event) => {
            setDistrictUuid(event.target.value);
            setFacilityUuid('');
          }}
        >
          <SelectItem value="" text={t('wholeCounty', 'Whole county')} />
          {districts.map((district) => (
            <SelectItem key={district.uuid} value={district.uuid} text={district.name} />
          ))}
        </Select>
      </div>

      <Search
        id={`${id}-search`}
        size="md"
        labelText={t('searchFacility', 'Search by facility name or MFL code')}
        placeholder={t('searchFacility', 'Search by facility name or MFL code')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setFacilityUuid('');
        }}
      />

      {error && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t('facilitiesLoadError', 'Facilities could not be loaded')}
          subtitle={t('nationalStillAvailable', 'National figures can still be run.')}
        />
      )}
      {isLoading && <InlineLoading description={t('loadingFacilities', 'Loading facilities...')} />}

      {!isLoading && !error && (query || countyUuid) && (
        <div className={styles.facilities}>
          {shown.length === 0 ? (
            <p className={styles.helper}>{t('noFacilitiesFound', 'No facilities match your search')}</p>
          ) : (
            <RadioButtonGroup
              legendText={t('facility', 'Facility')}
              name={`${id}-facility`}
              orientation="vertical"
              valueSelected={facilityUuid}
              onChange={(uuid) => setFacilityUuid(String(uuid))}
            >
              {shown.map((facility) => (
                <RadioButton
                  key={facility.uuid}
                  id={`${id}-${facility.uuid}`}
                  value={facility.uuid}
                  labelText={[facility.name, facility.district || facility.county, facility.code]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </RadioButtonGroup>
          )}
          {matches.length > shown.length && (
            <p className={styles.helper}>
              {t('moreFacilities', '{{count}} more; narrow the search to see them.', {
                count: matches.length - shown.length,
              })}
            </p>
          )}
          {facilityUuid && (
            <Button kind="ghost" size="sm" onClick={() => setFacilityUuid('')}>
              {t('clearFacility', 'Report on the whole area instead')}
            </Button>
          )}
        </div>
      )}

      <p className={styles.selection} data-testid="selected-location">
        {t('reportingOn', 'Reporting on: {{name}}', { name: selection.name })}
      </p>
    </fieldset>
  );
};

export default LocationPicker;
