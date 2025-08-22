const API = (path, opts={}) => {
  const base = process.env.REACT_APP_API || 'https://audio-call-5897.onrender.com';
  return fetch(base + path, opts).then(async res => {
    const text = await res.text();
    try { return JSON.parse(text); } catch(e) { return text; }
  });
};

export default API;
