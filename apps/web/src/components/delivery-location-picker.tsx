'use client';

import type { DeliveryLocation, DeliveryLocationQuery, DeliveryLocationType, DeliveryProvider } from '../../../../packages/contracts/src/delivery';
import { useEffect, useId, useRef, useState } from 'react';

type SearchInput = DeliveryLocationQuery;
type SearchFunction = (input: SearchInput, signal: AbortSignal) => Promise<DeliveryLocation[]>;

export function DeliveryLocationPicker({
  label,
  provider = 'NOVA_POSHTA',
  type,
  cityRef,
  initialQuery = '',
  value,
  onSelect,
  search = searchDeliveryLocations,
}: {
  label: string;
  provider?: Extract<DeliveryProvider, 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA'>;
  type: DeliveryLocationType;
  cityRef?: string;
  initialQuery?: string;
  value: DeliveryLocation | null;
  onSelect(value: DeliveryLocation | null): void;
  search?: SearchFunction;
}) {
  const listId = useId();
  const previousCityRef = useRef(cityRef);
  const [query, setQuery] = useState(value?.label ?? initialQuery);
  const [options, setOptions] = useState<DeliveryLocation[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (type === 'CITY' || previousCityRef.current === cityRef) return;
    previousCityRef.current = cityRef;
    setQuery(initialQuery);
    setOptions([]);
    setOpen(false);
    onSelect(null);
  }, [cityRef, initialQuery, onSelect, type]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2 || (type !== 'CITY' && !cityRef) || value?.label === query) {
      setLoading(false);
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      void search({ provider, type, query: normalized, cityRef }, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setOptions(results);
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setOptions([]);
          setError(true);
          setOpen(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cityRef, provider, query, search, type, value?.label]);

  function select(location: DeliveryLocation): void {
    setQuery(location.label);
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(location);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      select(options[activeIndex]);
    }
  }

  return <div className="delivery-location-picker">
    <label htmlFor={`${listId}-input`}>{label}</label>
    <div className="delivery-location-input-wrap">
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={query}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          if (value) onSelect(null);
        }}
        onFocus={() => { if (options.length > 0 || error) setOpen(true); }}
        onKeyDown={handleKeyDown}
      />
      <span className="delivery-location-progress" aria-live="polite">{loading ? 'Шукаємо…' : ''}</span>
    </div>
    <div className="delivery-location-results-wrap">
      {open && <ul id={listId} role="listbox" className="delivery-location-results">
        {error && <li role="alert" className="delivery-location-state">Не вдалося завантажити варіанти. Спробуйте ще раз.</li>}
        {!error && !loading && options.length === 0 && <li className="delivery-location-state">Нічого не знайдено</li>}
        {!error && options.map((option, index) => <li
          id={`${listId}-${index}`}
          key={option.ref}
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'is-active' : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => select(option)}
        >{option.label}</li>)}
      </ul>}
    </div>
  </div>;
}

async function searchDeliveryLocations(input: SearchInput, signal: AbortSignal): Promise<DeliveryLocation[]> {
  const params = new URLSearchParams({ provider: input.provider, type: input.type, query: input.query });
  if (input.cityRef) params.set('cityRef', input.cityRef);
  const response = await fetch(`/api/delivery/locations?${params.toString()}`, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Delivery location search failed');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Invalid delivery location response');
  return payload.filter(isDeliveryLocation).slice(0, 50);
}

function isDeliveryLocation(value: unknown): value is DeliveryLocation {
  return typeof value === 'object' && value !== null
    && typeof (value as DeliveryLocation).ref === 'string'
    && ['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA'].includes((value as DeliveryLocation).provider)
    && ['CITY', 'BRANCH', 'PARCEL_LOCKER'].includes((value as DeliveryLocation).type)
    && typeof (value as DeliveryLocation).label === 'string';
}
