// Maquette : lecture du fichier IFC en arriere-plan, pour que la page reste fluide pendant le calcul.
import IFC from "./core.js?v=1.3";
self.onmessage = (e) => {
  try { self.postMessage({ ok: true, m: IFC.build(e.data) }); }
  catch (err) { self.postMessage({ ok: false, err: err.message }); }
};
