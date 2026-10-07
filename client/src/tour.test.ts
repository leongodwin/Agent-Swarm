import { describe, expect, it } from 'vitest';
import { TOUR_WAYPOINTS, useStore } from './store';

describe('Presenter Tour Waypoints', () => {
  it('defines 10 distinct stations across Lobby and Upper Floors', () => {
    expect(TOUR_WAYPOINTS.length).toBe(10);
    const ids = new Set(TOUR_WAYPOINTS.map((w) => w.id));
    expect(ids.size).toBe(10);
  });

  it('contains expected Microsoft AI & Power Platform stations', () => {
    const ids = TOUR_WAYPOINTS.map((w) => w.id);
    expect(ids).toContain('lobby');
    expect(ids).toContain('war-room');
    expect(ids).toContain('copilot-kiosk');
    expect(ids).toContain('ceo-office');
    expect(ids).toContain('solution-arch');
    expect(ids).toContain('flow-telemetry');
    expect(ids).toContain('dataverse-erd');
    expect(ids).toContain('qa-guardrails');
    expect(ids).toContain('proposal-desk');
    expect(ids).toContain('hld-station');
  });

  it('cycles forward and backward through waypoints', () => {
    useStore.setState({ tourIndex: null, floor: 0 });
    
    // Toggle on starts at index 0
    useStore.getState().toggleTour();
    expect(useStore.getState().tourIndex).toBe(0);

    // Next goes to 1
    useStore.getState().nextTourWaypoint();
    expect(useStore.getState().tourIndex).toBe(1);

    // Prev goes back to 0
    useStore.getState().prevTourWaypoint();
    expect(useStore.getState().tourIndex).toBe(0);

    // Prev wraps around to last waypoint
    useStore.getState().prevTourWaypoint();
    expect(useStore.getState().tourIndex).toBe(TOUR_WAYPOINTS.length - 1);

    // Toggle off sets back to null
    useStore.getState().toggleTour();
    expect(useStore.getState().tourIndex).toBeNull();
  });
});
