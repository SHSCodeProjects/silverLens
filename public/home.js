document.addEventListener("DOMContentLoaded", function () {
    // State coordinates and zoom levels
    const stateCoordinates = {
      AL: { lat: 32.806671, lng: -86.79113, zoom: 7 },
      AK: { lat: 61.370716, lng: -152.404419, zoom: 5 },
      AZ: { lat: 33.729759, lng: -111.431221, zoom: 7 },
      AR: { lat: 34.969704, lng: -92.373123, zoom: 7 },
      CA: { lat: 36.116203, lng: -119.681564, zoom: 6 },
      CO: { lat: 39.059811, lng: -105.311104, zoom: 7 },
      CT: { lat: 41.597782, lng: -72.755371, zoom: 8 },
      DE: { lat: 39.318523, lng: -75.507141, zoom: 8 },
      FL: { lat: 27.766279, lng: -81.686783, zoom: 7 },
      GA: { lat: 33.040619, lng: -83.643074, zoom: 7 },
      HI: { lat: 21.094318, lng: -157.498337, zoom: 7 },
      ID: { lat: 44.240459, lng: -114.478828, zoom: 6 },
      IL: { lat: 40.349457, lng: -88.986137, zoom: 7 },
      IN: { lat: 39.849426, lng: -86.258278, zoom: 7 },
      IA: { lat: 42.011539, lng: -93.210526, zoom: 7 },
      KS: { lat: 38.5266, lng: -96.726486, zoom: 7 },
      KY: { lat: 37.66814, lng: -84.670067, zoom: 7 },
      LA: { lat: 31.169546, lng: -91.867805, zoom: 7 },
      ME: { lat: 44.693947, lng: -69.381927, zoom: 7 },
      MD: { lat: 39.063946, lng: -76.802101, zoom: 8 },
      MA: { lat: 42.230171, lng: -71.530106, zoom: 8 },
      MI: { lat: 43.326618, lng: -84.536095, zoom: 7 },
      MN: { lat: 45.694454, lng: -93.900192, zoom: 7 },
      MS: { lat: 32.741646, lng: -89.678696, zoom: 7 },
      MO: { lat: 38.456085, lng: -92.288368, zoom: 7 },
      MT: { lat: 46.921925, lng: -110.454353, zoom: 6 },
      NE: { lat: 41.12537, lng: -98.268082, zoom: 7 },
      NV: { lat: 38.313515, lng: -117.055374, zoom: 6 },
      NH: { lat: 43.452492, lng: -71.563896, zoom: 7 },
      NJ: { lat: 40.298904, lng: -74.521011, zoom: 8 },
      NM: { lat: 34.840515, lng: -106.248482, zoom: 7 },
      NY: { lat: 42.165726, lng: -74.948051, zoom: 7 },
      NC: { lat: 35.630066, lng: -79.806419, zoom: 7 },
      ND: { lat: 47.528912, lng: -99.784012, zoom: 6 },
      OH: { lat: 40.388783, lng: -82.764915, zoom: 7 },
      OK: { lat: 35.565342, lng: -96.928917, zoom: 7 },
      OR: { lat: 44.572021, lng: -122.070938, zoom: 7 },
      PA: { lat: 40.590752, lng: -77.209755, zoom: 7 },
      RI: { lat: 41.680893, lng: -71.51178, zoom: 8 },
      SC: { lat: 33.856892, lng: -80.945007, zoom: 7 },
      SD: { lat: 44.299782, lng: -99.438828, zoom: 7 },
      TN: { lat: 35.747845, lng: -86.692345, zoom: 7 },
      TX: { lat: 31.054487, lng: -97.563461, zoom: 6 },
      UT: { lat: 40.150032, lng: -111.862434, zoom: 7 },
      VT: { lat: 44.045876, lng: -72.710686, zoom: 8 },
      VA: { lat: 37.769337, lng: -78.169968, zoom: 7 },
      WA: { lat: 47.400902, lng: -121.490494, zoom: 7 },
      WV: { lat: 38.491226, lng: -80.954456, zoom: 7 },
      WI: { lat: 44.268543, lng: -89.616508, zoom: 7 },
      WY: { lat: 42.755966, lng: -107.30249, zoom: 6 },
    };
  
    // Fetch user data from the /home API endpoint
    fetch("/home")
      .then((response) => {
        if (!response.ok)
          throw new Error("Failed to fetch user data. Redirecting to login...");
        return response.json();
      })
      .then((user) => {
        console.log(`User loaded: ${user.firstName} ${user.lastName}`);
        const loggedInEmailElement = document.getElementById("logged-in-email");
        if (loggedInEmailElement) {
          loggedInEmailElement.textContent = `Logged in as: ${user.email}`;
        }
      })
      .catch(() => (window.location.href = "/auth/google"));
  
    // Add event listener for logout button
    const logoutButton = document.querySelector(".home-page-logout-button");
    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        window.location.href = "/logout";
      });
    }
  
    // Fetch and display the total number of communities on page load
    function fetchTotalCommunities() {
      fetch("/internal/get-total-communities")
        .then((response) => response.json())
        .then((data) => {
          const communityCountElement =
            document.getElementById("community-count");
          if (communityCountElement) {
            communityCountElement.textContent = `Total Communities: ${data.totalCommunities.toLocaleString()}`;
          }
        })
        .catch(console.error);
    }
    fetchTotalCommunities();
  
    // Initialize Leaflet map with default center and zoom
    const defaultCenter = [35.1508, -101.9]; // USA center
    const defaultZoom = 4;
    const map = L.map("map", {
      zoomControl: false, // Disable default zoom control
    }).setView(defaultCenter, defaultZoom);
  
    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  
    // Custom zoom controls positioned at the bottom-right
    L.control
      .zoom({
        position: "bottomright", // Position controls at bottom-right
      })
      .addTo(map);
  
    // Marker clustering (using Leaflet.markercluster plugin)
    const markers = L.markerClusterGroup();
  
    // Load initial markers
    fetchCommunitiesWithinBounds(map.getBounds(), map.getZoom());
  
    // Fetch communities data within map bounds with optional filters
    function fetchCommunitiesWithinBounds(bounds, zoomLevel) {
      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();
      const state = document.getElementById("state-filter")?.value;
  
      const url = new URL("/internal/get-communities", window.location.origin);
      url.searchParams.append("neLat", northEast.lat);
      url.searchParams.append("neLng", northEast.lng);
      url.searchParams.append("swLat", southWest.lat);
      url.searchParams.append("swLng", southWest.lng);
      url.searchParams.append("zoom", zoomLevel);
  
      if (state) {
        url.searchParams.append("state", state);
      }
  
      fetch(url)
        .then((response) => response.json())
        .then((data) => {
          console.log("Communities fetched within bounds:", data);
  
          markers.clearLayers();
  
          // Group communities strictly by their latitude and longitude only to avoid mismatches in zoom
          const uniqueCommunities = {};
          data.forEach((community) => {
            const latLngKey = `${community.FacLatitude}-${community.FacLongitude}`;
            if (!uniqueCommunities[latLngKey]) {
              uniqueCommunities[latLngKey] = community;
            }
          });
  
          // Add markers to the map
          for (const key in uniqueCommunities) {
            if (uniqueCommunities.hasOwnProperty(key)) {
              const community = uniqueCommunities[key];
  
              const tooltipContent = `
                <b>${community.FacilityName}</b><br>
                ${community.FacStreetAddress}, ${community.FacCity}, ${community.FacState} ${community.FacPostalCode}<br>
                Care Type: ${community.CareTypes}
              `;
  
              const marker = L.marker(
                [community.FacLatitude, community.FacLongitude],
                {
                  icon: L.divIcon({ className: "custom-marker" }),
                }
              ).bindTooltip(tooltipContent, {
                permanent: false,
                direction: "top",
                className: "custom-tooltip",
              });
  
              marker.on("mouseover", function () {
                this.openTooltip();
              });
  
              marker.on("mouseout", function () {
                this.closeTooltip();
              });
  
              markers.addLayer(marker);
            }
          }
  
          map.addLayer(markers);
        })
        .catch(console.error);
    }
  
    // Lazy loading on map move/zoom
    map.on("moveend", function () {
      const currentBounds = map.getBounds();
      const currentZoom = map.getZoom();
      fetchCommunitiesWithinBounds(currentBounds, currentZoom);
    });
  
    // Filter feature by state
    const stateFilter = document.getElementById("state-filter");
    stateFilter?.addEventListener("change", () => {
      fetchCommunitiesWithinBounds(map.getBounds(), map.getZoom());
  
      const selectedState = stateFilter.value;
      if (selectedState && stateCoordinates[selectedState]) {
        const { lat, lng, zoom } = stateCoordinates[selectedState];
        map.flyTo([lat, lng], zoom, {
          animate: true,
          duration: 1.5,
        });
      }
    });
  
    // Custom control for reset button aligned with zoom controls
    const resetControl = L.Control.extend({
      options: {
        position: "bottomright", // Align with zoom controls
      },
      onAdd: function () {
        const container = L.DomUtil.create(
          "div",
          "leaflet-bar leaflet-control leaflet-control-custom reset-button-control"
        );
        container.innerHTML = '<i class="fas fa-sync-alt"></i>';
  
        // Reset map view and state filter when button is clicked
        container.onclick = () => {
          map.setView(defaultCenter, defaultZoom);
          stateFilter.value = "";
          fetchCommunitiesWithinBounds(map.getBounds(), map.getZoom());
        };
  
        return container;
      },
    });
  
    // Add reset control
    map.addControl(new resetControl());
  });
  