declare module 'polygon-clipping' {
  const polygonClipping: {
    union: (geom: Geom, ...geoms: Geom[]) => MultiPolygon
    intersection: (geom: Geom, ...geoms: Geom[]) => MultiPolygon
    xor: (geom: Geom, ...geoms: Geom[]) => MultiPolygon
    difference: (subjectGeom: Geom, ...clipGeoms: Geom[]) => MultiPolygon
  }
  export default polygonClipping
}
