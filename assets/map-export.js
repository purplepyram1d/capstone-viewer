globalThis.CapstoneMapExport = (() => {
  const listingFields = {
    weather_alert:['weather_valid_until','weather_listed_until'],
    airport_disruption:['airport_valid_until','airport_listed_until'],
    road_closure:['road_valid_until','road_listed_until']
  };
  function featureCollection(markers, areas, view, outlook = null) {
    const features = [];
    const emitted = new Set();
    const primary = story => story.reports?.find(report=>report.id===story.representative_id) || story;
    const add = (record, point, role, geometry) => {
      const id = record.id + '-' + role;
      if (emitted.has(id)) return;
      emitted.add(id);
      const listing = listingFields[record.kind];
      features.push({
        type:'Feature',id,geometry,
        properties:{
          report_id:record.id, title:record.title, source:record.source, source_url:record.url,
          report_type:CapstoneTypes.typeId(record), evidence:CapstoneTypes.evidence(record),
          source_time_utc:record.ts, source_date_basis:record.source_date_basis || 'reported',
          source_published_utc:record.source_published_at || null, first_received_utc:record.first_received || null,
          date_precision:record.date_precision || 'timestamp',
          place:point.place || null, placement_basis:point.place_basis || null, geometry_role:role,
          superseded_at_utc:point.weather_replaced_at || null,
          ...(listing ? {published_window_end_utc:record[listing[0]] || null,
            listing_fresh_until_utc:view.live_connected && !view.replay_at ? record[listing[1]] || null : null} : {}),
          ...(record.kind==='road_closure' ? {closure_started_at_utc:record.road_started_at || null,
            closure_scheduled_end_utc:record.road_valid_until || null,closure_ended_at_utc:record.road_ended_at || null} : {}),
          country_code:point.country_code || null, state_codes:point.state_codes || [], province_code:point.province_code || null,
          ...(record.affected_regions?.length ? {affected_regions:record.affected_regions} : {})
        }
      });
    };
    const addArea = (record, point) => {
      const geometry = point.weather_area;
      if (['Polygon','MultiPolygon'].includes(geometry?.type)) add(record,point,'published_area',geometry);
    };
    for (const marker of markers) {
      const record = primary(marker);
      const {lon,lat} = marker;
      if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon)<=180 && Math.abs(lat)<=90) {
        add(record,marker,'mapped_point',{type:'Point',coordinates:[lon,lat]});
      }
      addArea(record,marker);
      if (marker.road_geometry?.type==='LineString') add(record,marker,'published_road_segment',marker.road_geometry);
      const track = marker.observation_track;
      if (track?.type==='MultiLineString') add(record,marker,'observation_track',track);
    }
    for (const area of areas) addArea(primary(area),area);
    for (const [index,feature] of (outlook?.areas.features || []).entries()) {
      features.push({type:'Feature',id:'spc-'+outlook.day+'-'+index,geometry:feature.geometry,
        properties:{geometry_role:'forecast_area',evidence:'Forecast',source:'NOAA Storm Prediction Center',
          source_url:outlook.source,forecast_day:outlook.day,risk:feature.properties.name,
          issued_at_utc:outlook.issued,valid_from_utc:outlook.starts,valid_until_utc:outlook.ends}});
    }
    return {type:'FeatureCollection',name:'Capstone Viewer map export',view,features};
  }
  return { featureCollection };
})();
