const API = (path, opts={}) => {
  const base = process.env.REACT_APP_API || 'http://localhost:5000';
  return fetch(base + path, opts).then(async res => {
    const text = await res.text();
    try { return JSON.parse(text); } catch(e) { return text; }
  });
};

export default API;
