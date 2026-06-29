import {
  Cartesian3,
  Math as CesiumMath,
  Viewer,
} from "cesium";

const BEIJING_INITIAL_VIEW = {
  lon: 116.4074,
  lat: 39.9042,
  height: 16000,
  headingDegrees: 0,
  pitchDegrees: -55,
  rollDegrees: 0,
};

export function flyToBeijingInitialView(viewer: Viewer, duration = 2.4) {
  // 初始视角只控制相机，不写入管点、管线、socket 等业务数据。
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      BEIJING_INITIAL_VIEW.lon,
      BEIJING_INITIAL_VIEW.lat,
      BEIJING_INITIAL_VIEW.height,
    ),
    orientation: {
      heading: CesiumMath.toRadians(BEIJING_INITIAL_VIEW.headingDegrees),
      pitch: CesiumMath.toRadians(BEIJING_INITIAL_VIEW.pitchDegrees),
      roll: CesiumMath.toRadians(BEIJING_INITIAL_VIEW.rollDegrees),
    },
    duration,
  });
}
