import React, { useCallback, useId, useMemo, useState } from 'react';
import {
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  RadioButtonSkeleton,
  Search,
  Select,
  SelectItem,
} from '@carbon/react';
import { useTranslation } from 'react-i18next';
import { facilityAreas, filterFacilities, useFacilities } from './facility-picker.resource';
import styles from './facility-picker.scss';

interface FacilityPickerProps {
  locationTag: string;
  mflCodeAttributeTypeUuid: string;
  maxResults: number;
  selectedLocationUuid?: string;
  defaultLocationUuid?: string;
  onChange: (locationUuid?: string) => void;
}

/**
 * The central facility switcher: every location with `locationTag`, searchable by name or MFL
 * code and narrowed by county and district. Used instead of the framework LocationPicker only
 * when `chooseLocation.locationTag` is configured.
 */
const FacilityPicker: React.FC<FacilityPickerProps> = ({
  locationTag,
  mflCodeAttributeTypeUuid,
  maxResults,
  selectedLocationUuid,
  defaultLocationUuid,
  onChange,
}) => {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const [countyUuid, setCountyUuid] = useState('');
  const [districtUuid, setDistrictUuid] = useState('');
  const { facilities, error, isLoading } = useFacilities(locationTag, mflCodeAttributeTypeUuid);

  const { counties, districts } = useMemo(() => facilityAreas(facilities, countyUuid), [facilities, countyUuid]);

  const matches = useMemo(() => {
    const filtered = filterFacilities(facilities, { query, countyUuid, districtUuid });
    const isUnfiltered = !query.trim() && !countyUuid && !districtUuid;
    const preferred = isUnfiltered && filtered.find((facility) => facility.uuid === defaultLocationUuid);
    return preferred ? [preferred, ...filtered.filter((facility) => facility !== preferred)] : filtered;
  }, [facilities, query, countyUuid, districtUuid, defaultLocationUuid]);

  const shown = matches.slice(0, maxResults);

  const clearSelection = useCallback(() => onChange(), [onChange]);

  return (
    <div className={styles.facilityPicker}>
      <Search
        id={`${id}-search`}
        labelText={t('searchFacility', 'Search by facility name or MFL code')}
        placeholder={t('searchFacility', 'Search by facility name or MFL code')}
        onChange={(event) => {
          clearSelection();
          setQuery(event.target.value);
        }}
        size="lg"
      />
      <div className={styles.areaFilters}>
        <Select
          id={`${id}-county`}
          labelText={t('county', 'County')}
          value={countyUuid}
          onChange={(event) => {
            clearSelection();
            setCountyUuid(event.target.value);
            setDistrictUuid('');
          }}
        >
          <SelectItem value="" text={t('allCounties', 'All counties')} />
          {counties.map((county) => (
            <SelectItem key={county.uuid} value={county.uuid} text={county.name} />
          ))}
        </Select>
        <Select
          id={`${id}-district`}
          labelText={t('district', 'District')}
          value={districtUuid}
          onChange={(event) => {
            clearSelection();
            setDistrictUuid(event.target.value);
          }}
        >
          <SelectItem value="" text={t('allDistricts', 'All districts')} />
          {districts.map((district) => (
            <SelectItem key={district.uuid} value={district.uuid} text={district.name} />
          ))}
        </Select>
      </div>

      {error && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t('facilitiesLoadError', 'Facilities could not be loaded')}
          subtitle={t('tryAgainLater', 'Try again, or contact your system administrator if this persists.')}
        />
      )}

      <div className={styles.results}>
        {isLoading ? (
          <div className={styles.loading}>
            {Array.from({ length: 4 }, (_, i) => (
              <RadioButtonSkeleton key={i} />
            ))}
          </div>
        ) : !error && shown.length === 0 ? (
          <p className={styles.emptyResults}>{t('noFacilitiesFound', 'No facilities match your search')}</p>
        ) : (
          <RadioButtonGroup
            legendText={t('facilities', 'Facilities')}
            name={`${id}-facility`}
            orientation="vertical"
            valueSelected={selectedLocationUuid ?? ''}
            onChange={(uuid) => onChange(String(uuid))}
          >
            {shown.map((facility) => (
              <RadioButton
                key={facility.uuid}
                id={`${id}-${facility.uuid}`}
                value={facility.uuid}
                className={styles.facility}
                labelText={
                  <span className={styles.facilityLabel}>
                    <span className={styles.facilityName}>{facility.name}</span>
                    <span className={styles.facilityMeta}>
                      {[facility.district || facility.county, facility.code].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                }
              />
            ))}
          </RadioButtonGroup>
        )}
        {matches.length > shown.length && (
          <p className={styles.truncated} role="status">
            {t('refineFacilitySearch', 'Showing {{shown}} of {{total}} facilities. Refine your search to see more.', {
              shown: shown.length,
              total: matches.length,
            })}
          </p>
        )}
      </div>
    </div>
  );
};

export default FacilityPicker;
