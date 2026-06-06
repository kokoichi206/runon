/**
 * 球面幾何ユーティリティ。
 * 論文 Eq.1 の弧長計算（haversine）と、多角形ウェイポイント生成のための
 * 方位・指定距離からの座標投影を提供する。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** WGS84 平均半径（メートル）。論文の距離計算と整合する一般的な値。 */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** 2 点間の大圏距離（メートル, haversine）。 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a から b への初期方位（度, 0=北, 時計回り）。 */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * 始点から指定距離・方位に進んだ地点（大圏航法 destination point）。
 * 多角形ウェイポイントを地表に配置するのに使う。
 */
export function destinationPoint(
  start: LatLng,
  distanceM: number,
  bearing: number,
): LatLng {
  const angular = distanceM / EARTH_RADIUS_M;
  const br = toRad(bearing);
  const lat1 = toRad(start.lat);
  const lng1 = toRad(start.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDeg(lat2),
    // 経度を -180..180 に正規化
    lng: ((toDeg(lng2) + 540) % 360) - 180,
  };
}
