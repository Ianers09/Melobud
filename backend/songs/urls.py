from django.urls import path

from . import views

urlpatterns = [
    path("", views.SongListCreateView.as_view()),
    path("<int:pk>/", views.SongDetailView.as_view()),
    path("<int:pk>/audio/", views.SongAudioView.as_view()),
    path("<int:pk>/reanalyze/", views.SongReanalyzeView.as_view()),
    path("<int:pk>/played/", views.SongPlayedView.as_view()),
]
